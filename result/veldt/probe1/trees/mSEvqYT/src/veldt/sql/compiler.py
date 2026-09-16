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
"""

from __future__ import annotations

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
from .parser import SelectStatement, TableRef, parse_select

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
        """Compile a statement, including any trailing set operation.

        Precedence: ``INTERSECT`` binds more tightly than ``UNION`` and
        ``EXCEPT``, which associate left-to-right.  The linked-list AST stores
        the chain right-recursively, so we unroll it here before folding.

        ``ORDER BY``, ``LIMIT`` and ``OFFSET`` written after the last select in
        a chain apply to the combined output, keyed on the combined output
        names (which come from the left-hand side).

        Raises:
            PlanningError: If the statement cannot be resolved against the
                catalog.
            TableNotFoundError: If it names an unregistered table.
        """
        # Collect the flat chain: [(stmt, op_kind, op_all), ...]
        stmts: List[Tuple[SelectStatement, str, bool]] = []
        current: Optional[SelectStatement] = statement
        while current is not None:
            op = current.set_operation
            if op is None:
                stmts.append((current, "", False))
                break
            stmts.append((current, op.kind, op.all))
            current = op.statement

        if len(stmts) == 1:
            return self._compile_select(stmts[0][0])

        # The ORDER BY / LIMIT / OFFSET on the last statement in the chain
        # belong to the whole combined result, not just that last select.
        # Strip them from the last statement before compiling the chain, then
        # re-apply them to the combined plan.
        last_stmt, last_op, last_all = stmts[-1]
        chain_order_by = last_stmt.order_by
        chain_limit = last_stmt.limit
        chain_offset = last_stmt.offset
        has_chain_tail = bool(chain_order_by) or chain_limit is not None or chain_offset

        if has_chain_tail:
            from dataclasses import replace as _dc_replace
            stripped = _dc_replace(last_stmt, order_by=(), limit=None, offset=0)
            stmts[-1] = (stripped, last_op, last_all)

        # Compile each SELECT independently.
        chain: List[Tuple[LogicalPlan, str, bool]] = [
            (self._compile_select(s), op, all_) for s, op, all_ in stmts
        ]

        # Fold the chain with proper precedence.
        # INTERSECT binds tighter than UNION / EXCEPT (same level).
        result = self._fold_chain(chain)

        # Apply the chain-level ORDER BY / LIMIT / OFFSET to the combined plan.
        if has_chain_tail and chain_order_by:
            order_keys: List[SortKey] = [
                SortKey(
                    self._qualify(key.expression, result.schema, {}),
                    key.ascending,
                    key.nulls_first,
                )
                for key in chain_order_by
            ]
            for key in order_keys:
                self.resolver.validate(key.expression, result.schema)
            result = Sort(result, tuple(order_keys))
        if has_chain_tail and (chain_limit is not None or chain_offset):
            result = Limit(result, chain_limit, chain_offset)

        return result

    def _fold_chain(
        self, chain: List[Tuple[LogicalPlan, str, bool]]
    ) -> LogicalPlan:
        """Fold a flat chain of set-operations with correct precedence.

        ``chain`` is a list of ``(plan, op_kind, op_all)`` tuples where
        ``op_kind`` and ``op_all`` are the operator connecting *this* plan to
        the *next* one.  The last element always has ``op_kind == ""``.
        """
        # Pass 1: collapse INTERSECT segments (higher precedence).
        # Walk left-to-right; whenever the connecting operator is INTERSECT we
        # combine immediately; otherwise we push onto a lower-priority stack.
        low: List[Tuple[LogicalPlan, str, bool]] = []
        acc_plan, acc_op, acc_all = chain[0]
        for next_plan, next_op, next_all in chain[1:]:
            if acc_op == "intersect":
                # Combine acc_plan INTERSECT next_plan right now.
                acc_plan = self._combine(acc_plan, next_plan, "intersect", acc_all)
                acc_op = next_op
                acc_all = next_all
            else:
                low.append((acc_plan, acc_op, acc_all))
                acc_plan, acc_op, acc_all = next_plan, next_op, next_all
        low.append((acc_plan, acc_op, acc_all))

        # Pass 2: fold the remaining UNION / EXCEPT segments left-to-right.
        result = low[0][0]
        for i in range(len(low) - 1):
            right_plan = low[i + 1][0]
            op_kind = low[i][1]
            op_all = low[i][2]
            result = self._combine(result, right_plan, op_kind, op_all)
        return result

    def _combine(
        self,
        left: LogicalPlan,
        right: LogicalPlan,
        kind: str,
        all: bool,
    ) -> LogicalPlan:
        """Build one set-operation node from two compiled plans."""
        op_name = kind.upper()
        if len(left.schema) != len(right.schema):
            raise PlanningError(
                f"{op_name} requires both sides to produce the same number of "
                f"columns: {len(left.schema)} and {len(right.schema)}"
            )
        if kind == "union":
            combined: LogicalPlan = Union(left, right, all)
            return combined if all else Distinct(combined)
        if kind == "intersect":
            combined = Intersect(left, right, all)
            return combined
        if kind == "except":
            combined = Except(left, right, all)
            return combined
        raise PlanningError(f"unsupported set operation {kind!r}")

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
