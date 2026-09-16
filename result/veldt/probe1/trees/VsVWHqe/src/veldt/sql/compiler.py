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

        Chains of set operations are flattened and reassembled with correct
        precedence: ``INTERSECT`` binds tighter than ``UNION`` / ``EXCEPT``,
        and ``UNION`` / ``EXCEPT`` associate left to right.

        ``ORDER BY``, ``LIMIT``, and ``OFFSET`` on the last ``SELECT`` in the
        chain are lifted to apply to the combined result, as required by the
        SQL standard.

        Raises:
            PlanningError: If the statement cannot be resolved against the
                catalog.
            TableNotFoundError: If it names an unregistered table.
        """
        # Flatten the right-recursive chain into a list of
        # (stmt, kind, all) tuples.  ``kind`` / ``all`` describe the
        # operator that connects this entry to the *next* one.
        chain: List[Tuple[SelectStatement, str, bool]] = []
        current = statement
        while current.set_operation is not None:
            op = current.set_operation
            chain.append((current, op.kind, op.all))
            current = op.statement
        # ``current`` is the final SELECT with no set operation.
        if not chain:
            return self._compile_select(statement)

        # The last SELECT in the chain may carry ORDER BY / LIMIT / OFFSET
        # that belongs to the whole chain, not just that sub-query.  Strip
        # them here and re-apply after combining.
        tail_order_by = current.order_by
        tail_limit = current.limit
        tail_offset = current.offset
        has_tail_sort_limit = tail_order_by or tail_limit is not None or tail_offset
        if has_tail_sort_limit:
            from dataclasses import replace as _dc_replace
            current = _dc_replace(
                current, order_by=(), limit=None, offset=0
            )

        # Compile every SELECT in the chain (each without set_operation).
        def _strip_set_op(s: SelectStatement) -> SelectStatement:
            """Return a copy of ``s`` without its set_operation field."""
            from dataclasses import replace as _dc_replace
            return _dc_replace(s, set_operation=None)

        stmts = [_strip_set_op(entry[0]) for entry in chain] + [current]
        plans: List[LogicalPlan] = [self._compile_select(s) for s in stmts]
        ops: List[Tuple[str, bool]] = [(entry[1], entry[2]) for entry in chain]

        # Validate column counts across the whole chain once.
        expected = len(plans[0].schema)
        for idx, plan in enumerate(plans[1:], 1):
            if len(plan.schema) != expected:
                kind = ops[idx - 1][0].upper()
                raise PlanningError(
                    f"{kind} requires both sides to produce the same number of "
                    f"columns: {expected} and {len(plan.schema)}"
                )

        # Apply precedence: INTERSECT binds tighter than UNION / EXCEPT.
        # Process left-to-right; whenever we encounter an INTERSECT we fold it
        # immediately with its right neighbour (and any further INTERSECT
        # neighbours after that), then continue with the accumulated result.
        result = plans[0]
        i = 0
        while i < len(ops):
            kind, all_ = ops[i]
            right = plans[i + 1]
            # If this is INTERSECT, keep consuming further INTERSECTs to the
            # right before combining (INTERSECT is left-assoc within its group).
            if kind == "intersect":
                right = _apply_set_op(kind, all_, result, right)
                result = right
                i += 1
                continue
            # For UNION / EXCEPT: peek ahead and consume any following
            # INTERSECT chain into the right-hand side first.
            j = i + 1
            while j < len(ops) and ops[j][0] == "intersect":
                right = _apply_set_op("intersect", ops[j][1], right, plans[j + 1])
                j += 1
            result = _apply_set_op(kind, all_, result, right)
            i = j

        # Re-apply ORDER BY / LIMIT / OFFSET to the combined result.
        if has_tail_sort_limit and tail_order_by:
            combined_schema = result.schema
            order_keys = [
                SortKey(
                    self._resolve_output_name(key.expression, combined_schema),
                    key.ascending,
                    key.nulls_first,
                )
                for key in tail_order_by
            ]
            result = Sort(result, tuple(order_keys))
        if has_tail_sort_limit and (tail_limit is not None or tail_offset):
            result = Limit(result, tail_limit, tail_offset)
        return result

    def _resolve_output_name(
        self, expression: "Expression", schema: "Schema"
    ) -> "Expression":
        """Resolve a sort key expression against a combined output schema.

        The expression was written against the last sub-query's input names,
        but after combining we only have the chain's output names.  For a bare
        column reference that names one of the output columns we just return it
        directly; more complex expressions are left unchanged.
        """
        from ..expr.ast import ColumnRef as _ColumnRef
        if isinstance(expression, _ColumnRef) and schema.has(expression.name):
            return expression
        return expression

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


def _apply_set_op(
    kind: str, all_: bool, left: "LogicalPlan", right: "LogicalPlan"
) -> "LogicalPlan":
    """Build one set-operator node from two already-compiled plans."""
    if kind == "union":
        combined: LogicalPlan = Union(left, right, all_)
        return combined if all_ else Distinct(combined)
    if kind == "intersect":
        return Intersect(left, right, all_)
    if kind == "except":
        return Except(left, right, all_)
    raise PlanningError(f"unsupported set operation {kind!r}")  # pragma: no cover


def compile_select(statement: SelectStatement, catalog: Catalog) -> LogicalPlan:
    """Compile an already parsed statement."""
    return SqlCompiler(catalog).compile(statement)


def compile_sql(sql: str, catalog: Catalog) -> LogicalPlan:
    """Parse and compile a statement in one step."""
    return SqlCompiler(catalog).compile(parse_select(sql))
