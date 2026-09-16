"""Turns a parsed statement into a validated logical plan.

The binder is where SQL's clause evaluation order becomes an explicit tree:

.. code-block:: text

    FROM -> WHERE -> GROUP BY -> HAVING -> SELECT -> DISTINCT -> ORDER BY -> LIMIT

Each stage adds one node, and every expression is resolved against the schema
produced by the stages below it.  ORDER BY is the only clause that can see two
scopes at once -- the projection's aliases and the pre-projection columns --
and that dual visibility is handled by projecting hidden sort columns and
pruning them again afterwards.
"""

from __future__ import annotations

from typing import Optional, Sequence

from ..config import DEFAULT_CONFIG, SessionConfig
from ..errors import BindingError, PlanningError
from ..functions.registry import FunctionRegistry, default_registry
from ..plan import expressions as X
from ..plan.logical import (
    Aggregate,
    Distinct,
    Filter,
    Join,
    Limit,
    LogicalPlan,
    NamedExpr,
    OneRow,
    Project,
    Scan,
    SetOp,
    SetOpKind,
    Sort,
    SortItem,
)
from ..sql import ast_nodes as A
from ..storage.catalog import Catalog
from ..types.coercion import unify
from ..types.schema import Field, Schema
from .aggregates import AggregateRewriter
from .scope import Scope
from .typecheck import ExpressionBinder, check_predicate, derive_name
from .validate import validate_plan

__all__ = ["Binder", "bind_statement"]

_HIDDEN_PREFIX = "__sort"


class Binder:
    """Binds statements against a catalog and a function registry."""

    def __init__(
        self,
        catalog: Catalog,
        registry: Optional[FunctionRegistry] = None,
        config: SessionConfig = DEFAULT_CONFIG,
    ) -> None:
        self.catalog = catalog
        self.registry = registry or default_registry()
        self.config = config

    # -- entry point -----------------------------------------------------

    def bind(self, statement: A.Statement) -> LogicalPlan:
        """Bind ``statement`` and validate the resulting plan."""

        plan = self._bind_statement(statement)
        return validate_plan(plan)

    def _bind_statement(self, statement: A.Statement) -> LogicalPlan:
        if isinstance(statement, A.SelectStatement):
            return self._bind_select(statement)
        if isinstance(statement, A.SetOperation):
            return self._bind_set_operation(statement)
        if isinstance(statement, A.ExplainStatement):
            return self._bind_statement(statement.statement)
        raise BindingError(
            f"cannot bind statement of type {type(statement).__name__}"
        )

    # -- FROM ------------------------------------------------------------

    def _bind_from(self, source: Optional[A.TableRef]) -> LogicalPlan:
        if source is None:
            return OneRow()
        return self._bind_table_ref(source)

    def _bind_table_ref(self, ref: A.TableRef) -> LogicalPlan:
        if isinstance(ref, A.NamedTable):
            table = self.catalog.get(ref.name)
            return Scan(
                table=table.name,
                alias=ref.effective_alias,
                table_schema=table.schema,
            )
        if isinstance(ref, A.JoinClause):
            return self._bind_join(ref)
        raise BindingError(f"unsupported table reference {type(ref).__name__}")

    def _bind_join(self, ref: A.JoinClause) -> LogicalPlan:
        left = self._bind_table_ref(ref.left)
        right = self._bind_table_ref(ref.right)
        combined = left.schema.merge(right.schema)
        self._reject_duplicate_aliases(combined)
        condition: Optional[X.Expr] = None
        if ref.condition is not None:
            binder = ExpressionBinder(
                Scope(combined), self.registry, clause="JOIN ON"
            )
            condition = binder.bind(ref.condition)
            check_predicate(condition, "JOIN ON")
        elif ref.using:
            condition = self._bind_using(ref.using, left.schema, right.schema)
        return Join(kind=ref.kind, left=left, right=right, condition=condition)

    def _bind_using(
        self, names: Sequence[str], left: Schema, right: Schema
    ) -> X.Expr:
        """Turn ``USING (a, b)`` into an equality conjunction."""

        predicates: list[X.Expr] = []
        for name in names:
            left_index = left.try_index_of(name)
            right_index = right.try_index_of(name)
            if left_index is None or right_index is None:
                raise BindingError(
                    f"USING column {name!r} must exist on both sides of the join"
                )
            left_field = left[left_index]
            right_field = right[right_index]
            predicates.append(
                X.BinaryExpr(
                    op="=",
                    left=X.Column(
                        name=left_field.name,
                        dtype=left_field.dtype,
                        qualifier=left_field.qualifier,
                    ),
                    right=X.Column(
                        name=right_field.name,
                        dtype=right_field.dtype,
                        qualifier=right_field.qualifier,
                    ),
                    dtype=X.TRUE.dtype.as_nullable(True),
                )
            )
        combined = X.combine_and(predicates)
        if combined is None:
            raise BindingError("USING requires at least one column")
        return combined

    def _reject_duplicate_aliases(self, schema: Schema) -> None:
        seen: set[str] = set()
        for field in schema:
            if field.qualifier is None:
                continue
            marker = field.qualifier
            if marker in seen:
                continue
            seen.add(marker)
        counts: dict[str, int] = {}
        for qualifier in (f.qualifier for f in schema if f.qualifier):
            counts[qualifier] = counts.get(qualifier, 0) + 1
        duplicates = sorted(
            name
            for name in counts
            if sum(1 for f in schema if f.qualifier == name and f.name == f.name) == 0
        )
        if duplicates:  # pragma: no cover - defensive
            raise BindingError(
                "duplicate table alias in FROM clause: " + ", ".join(duplicates)
            )

    # -- SELECT ----------------------------------------------------------

    def _bind_select(self, statement: A.SelectStatement) -> LogicalPlan:
        plan = self._bind_from(statement.source)
        scope = Scope(plan.schema)

        if statement.where is not None:
            binder = ExpressionBinder(scope, self.registry, clause="WHERE")
            predicate = binder.bind(statement.where)
            check_predicate(predicate, "WHERE")
            plan = Filter(input=plan, predicate=predicate)

        select_items = self._expand_projections(statement, scope)
        aggregating = bool(statement.group_by) or self._needs_aggregation(statement)

        rewriter = AggregateRewriter() if aggregating else None
        binder = ExpressionBinder(
            scope,
            self.registry,
            allow_aggregates=aggregating,
            clause="SELECT",
        )

        if rewriter is not None:
            self._register_group_keys(statement, select_items, scope, rewriter)

        projections: list[NamedExpr] = []
        for alias, node in select_items:
            bound = binder.bind(node)
            if rewriter is not None:
                bound = rewriter.rewrite(bound, clause="SELECT")
            name = alias or derive_name(bound)
            projections.append(NamedExpr(expression=bound, name=name))

        having: Optional[X.Expr] = None
        if statement.having is not None:
            if rewriter is None:
                raise BindingError(
                    "HAVING requires GROUP BY or an aggregate function",
                    hint="use WHERE to filter individual rows",
                )
            having_binder = ExpressionBinder(
                scope, self.registry, allow_aggregates=True, clause="HAVING"
            )
            having = rewriter.rewrite(
                having_binder.bind(statement.having), clause="HAVING"
            )
            check_predicate(having, "HAVING")

        sort_specs = self._bind_order_by(
            statement.order_by, scope, projections, rewriter
        )

        if rewriter is not None:
            plan = Aggregate(
                input=plan,
                group_by=rewriter.group_keys,
                aggregates=rewriter.aggregates,
            )
            if having is not None:
                plan = Filter(input=plan, predicate=having)

        plan = self._apply_projection_and_sort(
            plan,
            projections,
            sort_specs,
            distinct=statement.distinct,
        )
        return self._apply_limit(plan, statement.limit, statement.offset)

    def _expand_projections(
        self, statement: A.SelectStatement, scope: Scope
    ) -> list[tuple[Optional[str], A.Expression]]:
        """Expand ``*`` into explicit column references."""

        out: list[tuple[Optional[str], A.Expression]] = []
        for item in statement.projections:
            if isinstance(item, A.StarProjection):
                if statement.source is None:
                    raise BindingError("SELECT * requires a FROM clause")
                for column in scope.expand_star(item.qualifier):
                    out.append(
                        (
                            column.name,
                            A.ColumnRef(name=column.name, qualifier=column.qualifier),
                        )
                    )
                continue
            if isinstance(item, A.Projection):
                out.append((item.alias, item.expression))
                continue
            raise BindingError(f"unsupported select item {type(item).__name__}")
        if not out:
            raise BindingError("SELECT requires at least one output column")
        return out

    def _needs_aggregation(self, statement: A.SelectStatement) -> bool:
        """Whether any clause contains an aggregate call."""

        candidates: list[A.Node] = list(statement.projections)
        if statement.having is not None:
            candidates.append(statement.having)
        candidates.extend(item.expression for item in statement.order_by)
        for root in candidates:
            for node in A.walk(root):
                if isinstance(node, A.FunctionCall) and self.registry.is_aggregate(
                    node.name
                ):
                    return True
        return False

    def _register_group_keys(
        self,
        statement: A.SelectStatement,
        select_items: Sequence[tuple[Optional[str], A.Expression]],
        scope: Scope,
        rewriter: AggregateRewriter,
    ) -> None:
        binder = ExpressionBinder(scope, self.registry, clause="GROUP BY")
        for item in statement.group_by:
            node = self._resolve_group_ordinal(item, select_items)
            bound = binder.bind(node)
            if X.contains_aggregate(bound):
                raise BindingError("GROUP BY keys cannot contain aggregate functions")
            rewriter.add_group_key(bound, derive_name(bound))

    def _resolve_group_ordinal(
        self,
        item: A.Expression,
        select_items: Sequence[tuple[Optional[str], A.Expression]],
    ) -> A.Expression:
        """Translate ``GROUP BY 2`` into the second select-list expression."""

        if not isinstance(item, A.Literal) or not isinstance(item.value, int):
            return item
        if isinstance(item.value, bool):
            return item
        position = item.value
        if position < 1 or position > len(select_items):
            raise BindingError(
                f"GROUP BY position {position} is out of range",
                hint=f"the select list has {len(select_items)} items",
            )
        return select_items[position - 1][1]

    # -- ORDER BY --------------------------------------------------------

    def _bind_order_by(
        self,
        items: Sequence[A.OrderByItem],
        scope: Scope,
        projections: Sequence[NamedExpr],
        rewriter: Optional[AggregateRewriter],
    ) -> list["_SortSpec"]:
        specs: list[_SortSpec] = []
        by_name = {item.name: item for item in projections}
        for item in items:
            expression = self._bind_order_expression(
                item.expression, scope, projections, by_name, rewriter
            )
            specs.append(
                _SortSpec(
                    expression=expression,
                    descending=item.descending,
                    nulls_first=(
                        item.nulls_first
                        if item.nulls_first is not None
                        else self.config.nulls_first_default
                    ),
                )
            )
        return specs

    def _bind_order_expression(
        self,
        node: A.Expression,
        scope: Scope,
        projections: Sequence[NamedExpr],
        by_name: dict[str, NamedExpr],
        rewriter: Optional[AggregateRewriter],
    ) -> X.Expr:
        if isinstance(node, A.Literal) and isinstance(node.value, int):
            if not isinstance(node.value, bool):
                position = node.value
                if position < 1 or position > len(projections):
                    raise BindingError(
                        f"ORDER BY position {position} is out of range",
                        hint=f"the select list has {len(projections)} items",
                    )
                target = projections[position - 1]
                return X.Column(name=target.name, dtype=target.expression.dtype)
        if isinstance(node, A.ColumnRef) and node.qualifier is None:
            # A bare name in ORDER BY refers to an output column when one
            # exists, even if an input column shares that name.  This matters
            # for ``SELECT SUM(weight) AS weight ... ORDER BY weight``, where
            # only the output reading makes sense.
            alias = by_name.get(node.name)
            if alias is not None:
                return X.Column(name=alias.name, dtype=alias.expression.dtype)
        binder = ExpressionBinder(
            scope,
            self.registry,
            allow_aggregates=rewriter is not None,
            clause="ORDER BY",
        )
        bound = binder.bind(node)
        if rewriter is not None:
            bound = rewriter.rewrite(bound, clause="ORDER BY")
        return bound

    # -- projection, sorting, limiting -----------------------------------

    def _apply_projection_and_sort(
        self,
        plan: LogicalPlan,
        projections: Sequence[NamedExpr],
        sort_specs: Sequence["_SortSpec"],
        *,
        distinct: bool,
    ) -> LogicalPlan:
        visible = list(projections)
        output_names = {item.name for item in visible}
        by_expression = {item.expression: item.name for item in visible}

        hidden: list[NamedExpr] = []
        keys: list[SortItem] = []
        for index, spec in enumerate(sort_specs):
            expression = spec.expression
            if isinstance(expression, X.Column) and expression.qualifier is None:
                if expression.name in output_names:
                    keys.append(spec.to_item(expression))
                    continue
            existing = by_expression.get(expression)
            if existing is not None:
                keys.append(
                    spec.to_item(
                        X.Column(name=existing, dtype=expression.dtype)
                    )
                )
                continue
            hidden_name = f"{_HIDDEN_PREFIX}{index}"
            hidden.append(NamedExpr(expression=expression, name=hidden_name))
            keys.append(
                spec.to_item(X.Column(name=hidden_name, dtype=expression.dtype))
            )

        if hidden and distinct:
            raise BindingError(
                "ORDER BY expressions must appear in the select list when "
                "SELECT DISTINCT is used",
                hint="add the sort expression as an output column",
            )

        plan = Project(input=plan, projections=tuple(visible + hidden))
        if distinct:
            plan = Distinct(input=plan)
        if keys:
            plan = Sort(input=plan, keys=tuple(keys))
        if hidden:
            plan = Project(
                input=plan,
                projections=tuple(
                    NamedExpr(
                        expression=X.Column(
                            name=item.name, dtype=item.expression.dtype
                        ),
                        name=item.name,
                    )
                    for item in visible
                ),
            )
        return plan

    def _apply_limit(
        self,
        plan: LogicalPlan,
        limit: Optional[A.Expression],
        offset: Optional[A.Expression],
    ) -> LogicalPlan:
        count = _literal_int(limit, "LIMIT")
        skip = _literal_int(offset, "OFFSET") or 0
        if count is None and not skip:
            return plan
        return Limit(input=plan, count=count, offset=skip)

    # -- set operations --------------------------------------------------

    def _bind_set_operation(self, statement: A.SetOperation) -> LogicalPlan:
        left = self._bind_statement(statement.left)
        right = self._bind_statement(statement.right)
        schema = self._union_schema(left.schema, right.schema)
        plan: LogicalPlan = SetOp(
            kind=SetOpKind.UNION,
            left=left,
            right=right,
            all_rows=statement.all_rows,
            output_schema=schema,
        )
        if statement.order_by:
            scope = Scope(schema)
            projections = [
                NamedExpr(
                    expression=X.Column(name=field.name, dtype=field.dtype),
                    name=field.name,
                )
                for field in schema
            ]
            specs = self._bind_order_by(statement.order_by, scope, projections, None)
            plan = Sort(
                input=plan,
                keys=tuple(spec.to_item(spec.expression) for spec in specs),
            )
        return self._apply_limit(plan, statement.limit, statement.offset)

    def _union_schema(self, left: Schema, right: Schema) -> Schema:
        if len(left) != len(right):
            raise PlanningError(
                f"UNION arms produce {len(left)} and {len(right)} columns",
                hint="both arms must project the same number of columns",
            )
        fields: list[Field] = []
        for index, (a, b) in enumerate(zip(left, right)):
            dtype = unify([a.dtype, b.dtype], context=f"UNION column {index + 1}")
            fields.append(Field(name=a.name, dtype=dtype))
        return Schema(fields)


class _SortSpec:
    """A bound ORDER BY item before it is attached to a plan node."""

    __slots__ = ("expression", "descending", "nulls_first")

    def __init__(self, expression: X.Expr, descending: bool, nulls_first: bool) -> None:
        self.expression = expression
        self.descending = descending
        self.nulls_first = nulls_first

    def to_item(self, expression: X.Expr) -> SortItem:
        return SortItem(
            expression=expression,
            descending=self.descending,
            nulls_first=self.nulls_first,
        )


def _literal_int(node: Optional[A.Expression], clause: str) -> Optional[int]:
    if node is None:
        return None
    if isinstance(node, A.Literal) and isinstance(node.value, int):
        if isinstance(node.value, bool):
            raise BindingError(f"{clause} requires an integer literal")
        return node.value
    raise BindingError(f"{clause} requires an integer literal")


def bind_statement(
    statement: A.Statement,
    catalog: Catalog,
    registry: Optional[FunctionRegistry] = None,
    config: SessionConfig = DEFAULT_CONFIG,
) -> LogicalPlan:
    """Convenience wrapper constructing a :class:`Binder` per call."""

    return Binder(catalog, registry, config).bind(statement)
