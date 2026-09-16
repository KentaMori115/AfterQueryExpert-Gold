"""Post-binding validation of logical plans.

These checks catch inconsistencies that a rewriting bug would introduce.  They
are cheap enough to run after every bind and after the optimizer, which turns
a silent wrong answer into a loud error.
"""

from __future__ import annotations

from typing import Iterable

from ..errors import PlanningError
from ..plan.expressions import AggregateCall, Column, Expr
from ..plan.logical import (
    Aggregate,
    Filter,
    Join,
    LogicalPlan,
    Project,
    SetOp,
    Sort,
)
from ..types.datatypes import TypeKind

__all__ = ["validate_plan", "validate_expression_columns", "validate_union_shape"]


def validate_plan(plan: LogicalPlan) -> LogicalPlan:
    """Walk ``plan`` asserting structural invariants, then return it."""

    for node in plan.walk():
        _validate_node(node)
    return plan


def _validate_node(node: LogicalPlan) -> None:
    if isinstance(node, Filter):
        dtype = node.predicate.dtype
        if not (dtype.is_null or dtype.kind is TypeKind.BOOLEAN):
            raise PlanningError(
                f"Filter predicate must be boolean, got {dtype}"
            )
        _reject_aggregates(node.predicate, "Filter")
        validate_expression_columns(node.predicate, node.input.schema, "Filter")
    elif isinstance(node, Project):
        for item in node.projections:
            _reject_aggregates(item.expression, "Project")
            validate_expression_columns(item.expression, node.input.schema, "Project")
    elif isinstance(node, Aggregate):
        for item in node.group_by:
            _reject_aggregates(item.expression, "Aggregate group key")
            validate_expression_columns(
                item.expression, node.input.schema, "Aggregate"
            )
        for item in node.aggregates:
            if not isinstance(item.expression, AggregateCall):
                raise PlanningError("Aggregate outputs must be aggregate calls")
            for arg in item.expression.args:
                validate_expression_columns(arg, node.input.schema, "Aggregate")
    elif isinstance(node, Sort):
        for key in node.keys:
            _reject_aggregates(key.expression, "Sort")
            validate_expression_columns(key.expression, node.input.schema, "Sort")
    elif isinstance(node, Join):
        if node.condition is not None:
            _reject_aggregates(node.condition, "Join")
            validate_expression_columns(node.condition, node.schema, "Join")
    elif isinstance(node, SetOp):
        validate_union_shape(node)


def _reject_aggregates(expression: Expr, context: str) -> None:
    for inner in expression.walk():
        if isinstance(inner, AggregateCall):
            raise PlanningError(
                f"aggregate call {inner.to_sql()} appeared in a {context} node"
            )


def validate_expression_columns(expression: Expr, schema, context: str) -> None:
    """Assert every column referenced by ``expression`` exists in ``schema``."""

    for node in expression.walk():
        if not isinstance(node, Column):
            continue
        if schema.try_index_of(node.name, node.qualifier) is None:
            raise PlanningError(
                f"{context} references unknown column {node.qualified_name!r}",
                hint="available: " + ", ".join(schema.qualified_names),
            )


def validate_union_shape(node: SetOp) -> None:
    """Assert both arms of a set operation are union compatible."""

    left = node.left.schema
    right = node.right.schema
    if len(left) != len(right):
        raise PlanningError(
            f"UNION arms produce {len(left)} and {len(right)} columns",
            hint="both arms must project the same number of columns",
        )


def describe_conflicts(names: Iterable[str]) -> str:
    """Render duplicated names for error messages."""

    seen: dict[str, int] = {}
    for name in names:
        seen[name] = seen.get(name, 0) + 1
    repeated = sorted(name for name, count in seen.items() if count > 1)
    return ", ".join(repeated)
