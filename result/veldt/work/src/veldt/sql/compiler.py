"""Compilation from a parsed statement to a logical plan.

This is where names become columns and clauses become plan nodes. The order in
which clauses take effect is fixed by SQL and reflected in the plan the
compiler builds, from the bottom up::

    FROM / JOIN  ->  WHERE  ->  GROUP BY  ->  HAVING
                 ->  SELECT ->  DISTINCT  ->  ORDER BY  ->  LIMIT

Two details deserve their own note.

**Aggregate extraction.** ``SELECT SUM(x) + 1`` cannot be handed to the
aggregation operator directly. The compiler pulls every aggregate call out of
the projection, ``HAVING`` and ``ORDER BY`` clauses, computes them once in an
:class:`~veldt.plan.logical.Aggregate` node, and rewrites the surrounding
expressions to reference the aggregate's output columns.

**Sort placement.** ``ORDER BY`` may name either an input column or an output
alias. The compiler puts the sort below the projection when every key resolves
against the projection's input, and above it otherwise, so both spellings work.

**Set operations.** The parser records ``a UNION b EXCEPT c`` as a flat chain
in written order, so this is the stage that decides what pairs with what.
``INTERSECT`` is evaluated first; ``UNION`` and ``EXCEPT`` share a level and
are read left to right. Compiling the chain by recursing into its tail would
pair them right to left instead, which is a different query. An ``ORDER BY``,
``LIMIT`` or ``OFFSET`` written after the last select of a chain belongs to the
combined result rather than to that select, so those clauses are lifted off it
and applied to the folded plan.
"""

from __future__ import annotations

from dataclasses import replace as dataclass_replace
from typing import Dict, List, Optional, Sequence, Tuple

from ..errors import ColumnNotFoundError, PlanningError, TableNotFoundError
from ..expr.ast import (
    AggregateCall,
    Alias,
    ColumnRef,
    Expression,
    collect_aggregates,
    contains_aggregate,
    output_name,
    transform,
)
from ..expr.resolver import ExpressionResolver
from ..plan.logical import (
    Aggregate,
    Distinct,
    Except,
    Filter,
    Intersect,
    Join,
    Limit,
    LogicalPlan,
    Project,
    Scan,
    Sort,
    SortKey,
    Union,
)
from ..storage.catalog import Catalog
from ..types.schema import Schema
from .keywords import SET_OPERATOR_PRECEDENCE
from .parser import SelectStatement, SetOperation, TableRef, parse_select

__all__ = ["SqlCompiler", "compile_select", "compile_sql", "AliasMap"]

# Table alias -> {original column name (lowered) -> name in the current schema}.
AliasMap = Dict[str, Dict[str, str]]


class SqlCompiler:
    """Turns a :class:`SelectStatement` into a logical plan."""

    def __init__(
        self, catalog: Catalog, resolver: Optional[ExpressionResolver] = None
    ) -> None:
        self.catalog = catalog
        self.resolver = resolver or ExpressionResolver()

    # ------------------------------------------------------------------
    # Entry point
    # ------------------------------------------------------------------
    def compile(self, statement: SelectStatement) -> LogicalPlan:
        """Compile a statement, including any chain of set operations.

        Raises:
            PlanningError: If the statement cannot be resolved against the
                catalog.
            TableNotFoundError: If it names an unregistered table.
        """
        operands, operators, tail = self._flatten(statement)
        plan = self._fold(operands, operators)
        return plan if tail is None else self._apply_tail(plan, tail)

    # ------------------------------------------------------------------
    # Set operations
    # ------------------------------------------------------------------
    def _flatten(
        self, statement: SelectStatement
    ) -> Tuple[List[LogicalPlan], List[SetOperation], Optional[SelectStatement]]:
        """Compile every select in a chain, keeping the operators between them.

        The chain is read the way it was written, left to right. Nothing is
        paired here: what binds to what is :meth:`_fold`'s decision.

        Returns:
            The compiled operands, the operators between them, and — when
            there was more than one operand — the last statement of the chain,
            whose ordering and row-count clauses belong to the combined result
            and so have been withheld from its own plan.

        Raises:
            PlanningError: If the chain names an operator this compiler has no
                plan node for.
        """
        written: List[SelectStatement] = []
        operators: List[SetOperation] = []
        current: Optional[SelectStatement] = statement
        while current is not None:
            written.append(current)
            operation = current.set_operation
            if operation is None:
                break
            if operation.kind not in SET_OPERATOR_PRECEDENCE:
                raise PlanningError(f"unsupported set operation {operation.kind!r}")
            operators.append(operation)
            current = operation.statement
        if not operators:
            return [self._compile_select(statement)], [], None
        tail = written[-1]
        written[-1] = dataclass_replace(tail, order_by=(), limit=None, offset=0)
        return [self._compile_select(item) for item in written], operators, tail

    def _apply_tail(self, plan: LogicalPlan, tail: SelectStatement) -> LogicalPlan:
        """Order and cut a whole chain by the clauses written after its end.

        The keys are read against the combined output, whose names come from
        the leftmost select, so ``SELECT a AS k ... UNION ... ORDER BY k`` is
        the spelling that works whatever the other branches called the column.

        Raises:
            ColumnNotFoundError: If a key names no combined output column.
        """
        if tail.order_by:
            for key in tail.order_by:
                self.resolver.validate(key.expression, plan.schema)
            plan = Sort(plan, tuple(tail.order_by))
        if tail.limit is not None or tail.offset:
            plan = Limit(plan, tail.limit, tail.offset)
        return plan

    def _fold(
        self, operands: List[LogicalPlan], operators: List[SetOperation]
    ) -> LogicalPlan:
        """Reduce a flat chain into one plan, tightest operator first.

        A stack of pending operators is drained whenever the next operator
        binds no tighter than the one on top, which combines equal ranks left
        to right and lets ``INTERSECT`` reach across a neighbouring ``UNION``
        or ``EXCEPT``.
        """
        values: List[LogicalPlan] = [operands[0]]
        pending: List[SetOperation] = []
        for index, operation in enumerate(operators):
            rank = SET_OPERATOR_PRECEDENCE[operation.kind]
            while pending and SET_OPERATOR_PRECEDENCE[pending[-1].kind] >= rank:
                self._reduce(values, pending.pop())
            pending.append(operation)
            values.append(operands[index + 1])
        while pending:
            self._reduce(values, pending.pop())
        return values[0]

    def _reduce(self, values: List[LogicalPlan], operation: SetOperation) -> None:
        """Replace the top two plans on the stack with their combination."""
        right = values.pop()
        left = values.pop()
        values.append(self._combine(left, right, operation))

    def _combine(
        self, left: LogicalPlan, right: LogicalPlan, operation: SetOperation
    ) -> LogicalPlan:
        """Build the plan node for one set operator over two compiled sides.

        Raises:
            PlanningError: If the two sides produce different column counts.
        """
        if len(left.schema) != len(right.schema):
            raise PlanningError(
                f"{operation.kind.upper()} requires both sides to produce the same "
                f"number of columns: {len(left.schema)} and {len(right.schema)}"
            )
        if operation.kind == "intersect":
            return Intersect(left, right, operation.all)
        if operation.kind == "except":
            return Except(left, right, operation.all)
        combined: LogicalPlan = Union(left, right, operation.all)
        return combined if operation.all else Distinct(combined)

    # ------------------------------------------------------------------
    # Clause handling
    # ------------------------------------------------------------------
    def _compile_select(self, statement: SelectStatement) -> LogicalPlan:
        plan, aliases = self._compile_from(statement)
        if statement.where is not None:
            if contains_aggregate(statement.where):
                raise PlanningError("aggregates are not allowed in WHERE")
            predicate = self._qualify(statement.where, plan.schema, aliases)
            self.resolver.validate(predicate, plan.schema)
            plan = Filter(plan, predicate)

        projections = self._expand_stars(statement.projections, plan.schema, aliases)
        projections = [
            self._keep_written_name(item, self._qualify(item, plan.schema, aliases))
            for item in projections
        ]
        group_by = [
            self._qualify(item, plan.schema, aliases) for item in statement.group_by
        ]
        having = (
            self._qualify(statement.having, plan.schema, aliases)
            if statement.having is not None
            else None
        )
        order_by = [
            SortKey(
                self._qualify(key.expression, plan.schema, aliases),
                key.ascending,
                key.nulls_first,
            )
            for key in statement.order_by
        ]

        aggregating = bool(group_by) or any(
            contains_aggregate(item) for item in projections + ([having] if having else [])
        ) or any(contains_aggregate(key.expression) for key in order_by)

        if aggregating:
            plan, projections, having, order_by = self._compile_aggregation(
                plan, projections, group_by, having, order_by
            )
        elif having is not None:
            raise PlanningError("HAVING requires GROUP BY or an aggregate")

        for expression in projections:
            self.resolver.validate(expression, plan.schema)

        sort_below = bool(order_by) and all(
            _resolvable(self.resolver, key.expression, plan.schema) for key in order_by
        )
        if sort_below:
            plan = Sort(plan, tuple(order_by))
        plan = Project(plan, tuple(projections))
        if statement.distinct:
            plan = Distinct(plan)
        if order_by and not sort_below:
            order_by = self._rebind_to_output(order_by, projections)
            for key in order_by:
                self.resolver.validate(key.expression, plan.schema)
            plan = Sort(plan, tuple(order_by))
        if statement.limit is not None or statement.offset:
            plan = Limit(plan, statement.limit, statement.offset)
        return plan

    def _compile_from(
        self, statement: SelectStatement
    ) -> Tuple[LogicalPlan, "AliasMap"]:
        """Build the input plan and map each alias onto its output columns.

        A join renames duplicate column names on its right side, so the map
        records where each table's columns ended up rather than assuming the
        name survived unchanged. Without it ``o.uid = u.uid`` would resolve
        both sides to the same merged column and silently become a self
        comparison.

        Raises:
            PlanningError: If the statement has no ``FROM`` clause.
        """
        if statement.from_table is None:
            raise PlanningError("SELECT without FROM is not supported")
        aliases: AliasMap = {}
        plan = self._scan(statement.from_table, aliases)
        for clause in statement.joins:
            right = self._scan(clause.table, aliases)
            merged = plan.schema.merge(right.schema)
            self._rebind(aliases, clause.table.key, right.schema, merged, len(plan.schema))
            if clause.how == "cross":
                plan = Join(plan, right, None, "cross")
                continue
            condition = self._qualify(clause.condition, merged, aliases)
            node = Join(plan, right, condition, clause.how)
            self.resolver.validate(condition, node.schema)
            plan = node
        return plan, aliases

    def _scan(self, reference: TableRef, aliases: "AliasMap") -> LogicalPlan:
        """Resolve one table reference into a scan.

        Raises:
            PlanningError: If the alias is already in use.
        """
        source = self.catalog.get(reference.name)
        key = reference.key.lower()
        if key in aliases:
            raise PlanningError(f"duplicate table alias {reference.key!r}")
        aliases[key] = {field.name.lower(): field.name for field in source.schema}
        return Scan(source, reference.alias or reference.name)

    @staticmethod
    def _rebind(
        aliases: "AliasMap",
        key: str,
        right_schema: Schema,
        merged: Schema,
        offset: int,
    ) -> None:
        """Point a just-joined table's columns at their merged names."""
        names = merged.names
        aliases[key.lower()] = {
            field.name.lower(): names[offset + index]
            for index, field in enumerate(right_schema)
        }

    def _compile_aggregation(
        self,
        plan: LogicalPlan,
        projections: List[Expression],
        group_by: List[Expression],
        having: Optional[Expression],
        order_by: List[SortKey],
    ) -> Tuple[LogicalPlan, List[Expression], Optional[Expression], List[SortKey]]:
        """Insert an aggregation and rewrite the clauses above it."""
        calls: List[AggregateCall] = []
        for expression in projections:
            calls.extend(collect_aggregates(expression))
        if having is not None:
            calls.extend(collect_aggregates(having))
        for key in order_by:
            calls.extend(collect_aggregates(key.expression))
        unique_calls: List[AggregateCall] = []
        for call in calls:
            if call not in unique_calls:
                unique_calls.append(call)

        for expression in group_by + list(unique_calls):
            self.resolver.validate(expression, plan.schema)
        self._check_grouped_projections(projections, group_by)

        node = Aggregate(plan, tuple(group_by), tuple(unique_calls))
        schema = node.schema
        replacements: Dict[Expression, Expression] = {}
        for index, expression in enumerate(group_by):
            replacements[expression] = ColumnRef(schema[index].name)
        for offset, call in enumerate(unique_calls):
            replacements[call] = ColumnRef(schema[len(group_by) + offset].name)

        rewritten = [_replace(item, replacements) for item in projections]
        new_having = (
            _substitute(having, replacements) if having is not None else None
        )
        new_order = [
            SortKey(
                _substitute(key.expression, replacements),
                key.ascending,
                key.nulls_first,
            )
            for key in order_by
        ]
        result: LogicalPlan = node
        if new_having is not None:
            self.resolver.validate(new_having, result.schema)
            result = Filter(result, new_having)
        return result, rewritten, new_having, new_order

    def _check_grouped_projections(
        self, projections: Sequence[Expression], group_by: Sequence[Expression]
    ) -> None:
        """Reject columns that are neither grouped nor aggregated.

        Raises:
            PlanningError: If a projection references a column outside the
                grouping keys and outside an aggregate.
        """
        grouped = {item.to_sql() for item in group_by}
        for expression in projections:
            source = expression.child if isinstance(expression, Alias) else expression
            if source.to_sql() in grouped:
                continue
            for node in _non_aggregate_columns(source):
                if node.to_sql() not in grouped:
                    raise PlanningError(
                        f"column {node.qualified_name!r} must appear in GROUP BY "
                        "or be used in an aggregate"
                    )

    # ------------------------------------------------------------------
    # Name resolution
    # ------------------------------------------------------------------
    def _expand_stars(
        self,
        projections: Sequence[Expression],
        schema: Schema,
        aliases: AliasMap,
    ) -> List[Expression]:
        """Replace ``*`` and ``t.*`` with explicit column references.

        Raises:
            PlanningError: If a qualified star names an unknown table, or the
                projection list ends up empty.
        """
        expanded: List[Expression] = []
        for expression in projections:
            if not (isinstance(expression, ColumnRef) and expression.name == "*"):
                expanded.append(expression)
                continue
            if expression.qualifier is None:
                expanded.extend(ColumnRef(field.name) for field in schema)
                continue
            columns = aliases.get(expression.qualifier.lower())
            if columns is None:
                raise PlanningError(f"unknown table qualifier {expression.qualifier!r}")
            expanded.extend(
                ColumnRef(name) for name in columns.values() if schema.has(name)
            )
        if not expanded:
            raise PlanningError("SELECT must produce at least one column")
        return expanded

    @staticmethod
    def _rebind_to_output(
        order_by: List[SortKey], projections: Sequence[Expression]
    ) -> List[SortKey]:
        """Rewrite sort keys to speak in the projection's output names.

        A sort placed above the projection can only see what the projection
        emits, so a key written as the underlying expression — ``d.driver``
        where the projection renamed it, or an aggregate the projection
        aliased — has to be pointed at the output column instead.
        """
        outputs: Dict[Expression, Expression] = {}
        for expression in projections:
            source = expression.child if isinstance(expression, Alias) else expression
            outputs.setdefault(source, ColumnRef(output_name(expression)))
        return [
            SortKey(_substitute(key.expression, outputs), key.ascending, key.nulls_first)
            for key in order_by
        ]

    @staticmethod
    def _keep_written_name(original: Expression, qualified: Expression) -> Expression:
        """Preserve the column name the query wrote, not the resolved one.

        A join renames duplicate right-side columns, so ``SELECT d.driver``
        would otherwise come back as ``driver_right``. The rename matters
        internally; the output name should still be what was asked for.
        """
        if (
            isinstance(original, ColumnRef)
            and original.qualifier
            and isinstance(qualified, ColumnRef)
            and qualified.name != original.name
        ):
            return Alias(qualified, original.name)
        return qualified

    def _qualify(
        self, expression: Expression, schema: Schema, aliases: AliasMap
    ) -> Expression:
        """Rewrite qualified references to the names the schema really uses.

        A source may expose literally qualified names, in which case the
        reference is already correct. Otherwise the alias map says where that
        table's column ended up after any join renaming.

        Raises:
            PlanningError: If the qualifier names no table in the statement.
            ColumnNotFoundError: If a qualified reference names a column the
                aliased table does not have.
        """

        def rule(node: Expression) -> Expression:
            if not isinstance(node, ColumnRef) or node.qualifier is None:
                return node
            qualified = f"{node.qualifier}.{node.name}"
            if schema.has(qualified):
                return node
            columns = aliases.get(node.qualifier.lower())
            if columns is None:
                raise PlanningError(
                    f"unknown table qualifier {node.qualifier!r} in "
                    f"{node.qualified_name!r}"
                )
            resolved = columns.get(node.name.lower())
            if resolved is None:
                raise ColumnNotFoundError(qualified, list(columns.values()))
            return ColumnRef(resolved)

        return transform(expression, rule)


def _non_aggregate_columns(expression: Expression) -> List[ColumnRef]:
    """Return column references that sit outside any aggregate call."""
    found: List[ColumnRef] = []

    def visit(node: Expression) -> None:
        if isinstance(node, AggregateCall):
            return
        if isinstance(node, ColumnRef):
            found.append(node)
            return
        for child in node.children():
            visit(child)

    visit(expression)
    return found


def _substitute(
    expression: Expression, replacements: Dict[Expression, Expression]
) -> Expression:
    """Substitute whole sub-expressions, adding no alias of its own."""

    def rule(node: Expression) -> Expression:
        return replacements.get(node, node)

    return transform(expression, rule)


def _replace(
    expression: Expression, replacements: Dict[Expression, Expression]
) -> Expression:
    """Substitute inside a projection while keeping its output name.

    Rewriting ``round(sum(x), 2)`` into ``round("sum(x)", 2)`` would otherwise
    change the column name the query produces, so the original name is pinned
    with an alias — but never a second one on top of an alias the user wrote.
    """
    if isinstance(expression, Alias):
        return Alias(_substitute(expression.child, replacements), expression.name)
    replaced = _substitute(expression, replacements)
    if replaced is not expression and output_name(replaced) != output_name(expression):
        return Alias(replaced, output_name(expression))
    return replaced


def _resolvable(resolver: ExpressionResolver, expression: Expression, schema: Schema) -> bool:
    """True when an expression can be resolved against ``schema``."""
    try:
        resolver.validate(expression, schema)
    except (ColumnNotFoundError, PlanningError):
        return False
    return True


def compile_select(statement: SelectStatement, catalog: Catalog) -> LogicalPlan:
    """Compile an already parsed statement."""
    return SqlCompiler(catalog).compile(statement)


def compile_sql(sql: str, catalog: Catalog) -> LogicalPlan:
    """Parse and compile a statement in one step."""
    return SqlCompiler(catalog).compile(parse_select(sql))
