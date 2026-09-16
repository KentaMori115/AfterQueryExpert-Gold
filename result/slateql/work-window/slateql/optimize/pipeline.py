"""The optimizer pipeline.

Rules run in a fixed order, and the whole sequence repeats until the plan stops
changing or the iteration cap is hit.  The cap exists purely as a safety net:
a well-behaved rule set converges in two or three passes, and hitting the cap
means some rule is not idempotent.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional, Sequence

from ..analyze.validate import validate_plan
from ..config import DEFAULT_CONFIG, SessionConfig
from ..errors import OptimizerError
from ..functions.registry import FunctionRegistry
from ..plan.logical import LogicalPlan
from ..plan.visitor import same_plan
from ..storage.catalog import Catalog
from .rule import Rule, RuleContext
from .rules import (
    ConstantFolding,
    JoinInputOrdering,
    LimitPushdown,
    PredicatePushdown,
    ProjectionPruning,
    RemoveRedundantOperators,
    SimplifyExpressions,
)

__all__ = ["Optimizer", "OptimizationTrace", "default_rules"]

MAX_ITERATIONS = 8


@dataclass
class OptimizationTrace:
    """Record of which rules changed the plan, for ``EXPLAIN VERBOSE``."""

    iterations: int = 0
    applied: list[str] = field(default_factory=list)

    def record(self, rule_name: str) -> None:
        if rule_name not in self.applied:
            self.applied.append(rule_name)

    def describe(self) -> str:
        if not self.applied:
            return f"no rules changed the plan ({self.iterations} passes)"
        return (
            f"{self.iterations} passes, rules applied: " + ", ".join(self.applied)
        )


def default_rules(registry: Optional[FunctionRegistry] = None) -> list[Rule]:
    """The standard rule sequence.

    Order matters: simplification and folding run first so that pushdown sees
    the smallest possible predicates, and pruning runs last so that it observes
    the final set of column references.
    """

    return [
        ConstantFolding(registry),
        SimplifyExpressions(),
        RemoveRedundantOperators(),
        PredicatePushdown(),
        LimitPushdown(),
        JoinInputOrdering(),
        ProjectionPruning(),
    ]


class Optimizer:
    """Applies rules to a logical plan until it reaches a fixed point."""

    def __init__(
        self,
        catalog: Optional[Catalog] = None,
        *,
        config: SessionConfig = DEFAULT_CONFIG,
        rules: Optional[Sequence[Rule]] = None,
        registry: Optional[FunctionRegistry] = None,
        max_iterations: int = MAX_ITERATIONS,
    ) -> None:
        self.catalog = catalog
        self.config = config
        self.rules = list(rules) if rules is not None else default_rules(registry)
        self.max_iterations = max_iterations

    def optimize(
        self, plan: LogicalPlan, *, trace: Optional[OptimizationTrace] = None
    ) -> LogicalPlan:
        """Return an equivalent plan that should be cheaper to run."""

        if not self.config.optimize:
            return plan
        context = RuleContext(
            self.catalog, use_statistics=self.config.collect_statistics
        )
        current = plan
        for iteration in range(1, self.max_iterations + 1):
            previous = current
            for rule in self.rules:
                rewritten = rule.apply(current, context)
                if rewritten is not current and not same_plan(rewritten, current):
                    self._check(rule, current, rewritten)
                    if trace is not None:
                        trace.record(rule.name)
                    current = rewritten
            if trace is not None:
                trace.iterations = iteration
            if same_plan(previous, current):
                return current
        return current

    def _check(self, rule: Rule, before: LogicalPlan, after: LogicalPlan) -> None:
        """Assert a rule preserved the output shape and produced a valid plan."""

        if len(before.schema) != len(after.schema):
            raise OptimizerError(
                f"rule {rule.name!r} changed the output width from "
                f"{len(before.schema)} to {len(after.schema)} columns"
            )
        if before.schema.names != after.schema.names:
            raise OptimizerError(
                f"rule {rule.name!r} changed the output column names"
            )
        validate_plan(after)
