"""The rule-driven plan optimizer.

The optimizer applies its rules in order, repeatedly, until either the plan
stops changing or the iteration budget runs out. Reaching the budget is not an
error — it means some pair of rules keeps undoing each other's work, and the
plan produced is still correct, just possibly not minimal.

Every optimization run records which rules changed the plan, which makes it
straightforward to assert on rule behaviour without reaching into internals.
"""

from __future__ import annotations

from dataclasses import dataclass, field as dataclass_field
from typing import Dict, List, Optional, Sequence

from ..errors import PlanningError
from ..types.schema import Schema
from .logical import LogicalPlan
from .rules import Rule, default_rules

__all__ = ["OptimizationReport", "Optimizer", "optimize", "default_optimizer"]

DEFAULT_MAX_ITERATIONS = 8


@dataclass(frozen=True)
class OptimizationReport:
    """A record of what one optimization run did."""

    iterations: int
    applied: List[str] = dataclass_field(default_factory=list)
    converged: bool = True

    @property
    def changed(self) -> bool:
        """True when at least one rule rewrote the plan."""
        return bool(self.applied)

    def counts(self) -> Dict[str, int]:
        """Return how many times each rule changed the plan."""
        tally: Dict[str, int] = {}
        for name in self.applied:
            tally[name] = tally.get(name, 0) + 1
        return tally

    def describe(self) -> str:
        """Render the report as one line."""
        if not self.applied:
            return f"no rules applied in {self.iterations} iteration(s)"
        parts = [f"{name}x{count}" if count > 1 else name for name, count in self.counts().items()]
        status = "" if self.converged else " (iteration limit reached)"
        return f"applied {', '.join(parts)} in {self.iterations} iteration(s){status}"


class Optimizer:
    """Applies a list of rules to a logical plan until it settles."""

    def __init__(
        self,
        rules: Optional[Sequence[Rule]] = None,
        max_iterations: int = DEFAULT_MAX_ITERATIONS,
    ) -> None:
        if max_iterations < 1:
            raise ValueError("max_iterations must be at least 1")
        self.rules: List[Rule] = list(rules) if rules is not None else default_rules()
        self.max_iterations = max_iterations
        self._last_report: Optional[OptimizationReport] = None

    @property
    def last_report(self) -> Optional[OptimizationReport]:
        """The report from the most recent :meth:`optimize` call."""
        return self._last_report

    def optimize(self, plan: LogicalPlan) -> LogicalPlan:
        """Rewrite ``plan`` and return the optimized version.

        Raises:
            PlanningError: If a rule changes the plan's output schema, which
                always indicates a bug in the rule rather than in the query.
        """
        original_schema = plan.schema
        applied: List[str] = []
        current = plan
        iterations = 0
        converged = False
        for iterations in range(1, self.max_iterations + 1):
            changed = False
            for rule in self.rules:
                rewritten = rule.apply(current)
                if rewritten is current or rewritten == current:
                    continue
                _check_schema(original_schema, rewritten, rule)
                current = rewritten
                applied.append(rule.name)
                changed = True
            if not changed:
                converged = True
                break
        self._last_report = OptimizationReport(iterations, applied, converged)
        return current

    def with_rule(self, rule: Rule) -> "Optimizer":
        """Return a copy of this optimizer with one extra rule appended."""
        return Optimizer(self.rules + [rule], self.max_iterations)

    def without_rule(self, name: str) -> "Optimizer":
        """Return a copy of this optimizer with a named rule removed."""
        kept = [rule for rule in self.rules if rule.name != name]
        return Optimizer(kept, self.max_iterations)

    def rule_names(self) -> List[str]:
        """Return the names of the configured rules, in order."""
        return [rule.name for rule in self.rules]

    def __repr__(self) -> str:
        return f"Optimizer({', '.join(self.rule_names())})"


def _check_schema(expected: Schema, plan: LogicalPlan, rule: Rule) -> None:
    """Guard against a rule silently changing the query's result shape."""
    actual = plan.schema
    if actual.names != expected.names:
        raise PlanningError(
            f"rule {rule.name} changed the output columns from "
            f"{expected.names} to {actual.names}"
        )
    if actual.dtypes != expected.dtypes:
        raise PlanningError(
            f"rule {rule.name} changed the output types from "
            f"{[str(item) for item in expected.dtypes]} to "
            f"{[str(item) for item in actual.dtypes]}"
        )


def default_optimizer() -> Optimizer:
    """Return an optimizer configured with the default rule set."""
    return Optimizer()


def optimize(plan: LogicalPlan) -> LogicalPlan:
    """Optimize a plan with the default rule set."""
    return default_optimizer().optimize(plan)
