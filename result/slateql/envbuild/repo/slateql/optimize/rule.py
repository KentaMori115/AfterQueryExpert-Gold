"""The optimizer rule interface.

A rule is a pure function from plan to plan.  Rules must be idempotent -- the
pipeline runs them repeatedly until the plan stops changing, and a rule that
keeps rewriting its own output would never converge.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Callable, Optional

from ..plan.logical import LogicalPlan
from ..storage.catalog import Catalog

__all__ = ["Rule", "RuleContext", "FunctionRule"]


class RuleContext:
    """Ambient information a rule may consult."""

    __slots__ = ("catalog", "use_statistics")

    def __init__(
        self, catalog: Optional[Catalog] = None, *, use_statistics: bool = True
    ) -> None:
        self.catalog = catalog
        self.use_statistics = use_statistics

    def table_rows(self, name: str) -> Optional[int]:
        """Estimated row count for a table, or ``None`` when unknown."""

        if self.catalog is None or not self.use_statistics:
            return None
        table = self.catalog.try_get(name)
        if table is None:
            return None
        return table.estimated_row_count()


class Rule(ABC):
    """Base class for optimizer rules."""

    #: Human readable name shown by ``EXPLAIN VERBOSE``.
    name: str = "rule"

    @abstractmethod
    def apply(self, plan: LogicalPlan, context: RuleContext) -> LogicalPlan:
        """Return a rewritten plan, or ``plan`` itself when nothing applies."""

    def __call__(self, plan: LogicalPlan, context: RuleContext) -> LogicalPlan:
        return self.apply(plan, context)

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<Rule {self.name}>"


class FunctionRule(Rule):
    """Adapts a plain function into a :class:`Rule`."""

    def __init__(
        self,
        name: str,
        function: Callable[[LogicalPlan, RuleContext], LogicalPlan],
    ) -> None:
        self.name = name
        self._function = function

    def apply(self, plan: LogicalPlan, context: RuleContext) -> LogicalPlan:
        return self._function(plan, context)
