"""Column pruning.

Every scan learns which of its columns the rest of the plan actually reads and
stops producing the others.  Because each scan carries a unique alias, the set
of live columns can be collected in a single pass over the whole tree rather
than threaded down through each operator.
"""

from __future__ import annotations

from ...plan import expressions as X
from ...plan.logical import Distinct, LogicalPlan, Scan, SetOp
from ...plan.visitor import transform_up
from ...types.schema import Schema
from ..rule import Rule, RuleContext

__all__ = ["ProjectionPruning", "live_columns"]


class ProjectionPruning(Rule):
    """Restricts each scan to the columns something above it references."""

    name = "projection-pruning"

    def apply(self, plan: LogicalPlan, context: RuleContext) -> LogicalPlan:
        live = live_columns(plan)

        def _prune(node: LogicalPlan) -> LogicalPlan:
            if not isinstance(node, Scan):
                return node
            wanted = live.get(node.alias, set())
            ordinals = [
                index
                for index, field in enumerate(node.table_schema)
                if field.name in wanted
            ]
            if node.projection is None and len(ordinals) == len(node.table_schema):
                return node
            if node.projection is not None and tuple(ordinals) == node.projection:
                return node
            return node.with_projection(ordinals)

        return transform_up(plan, _prune)


def live_columns(plan: LogicalPlan) -> dict[str, set[str]]:
    """Map each relation alias to the column names referenced anywhere.

    Three things keep a column alive: an expression that names it, the root
    plan's own output (nothing above it exists to reference it explicitly), and
    the inputs of positional operators -- DISTINCT compares whole rows and a
    set operation matches its arms column by column.
    """

    wanted: dict[str, set[str]] = {}

    def _keep(schema: Schema) -> None:
        for field in schema:
            if field.qualifier is None:
                continue
            wanted.setdefault(field.qualifier, set()).add(field.name)

    _keep(plan.schema)
    for node in plan.walk():
        for expression in node.expressions():
            for column in X.columns_of(expression):
                if column.qualifier is None:
                    continue
                wanted.setdefault(column.qualifier, set()).add(column.name)
        if isinstance(node, (Distinct, SetOp)):
            for child in node.children():
                _keep(child.schema)
    return wanted
