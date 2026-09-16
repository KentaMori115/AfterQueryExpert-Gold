"""Choosing which facts the planner may use.

The model never sees the specification: it sees a bounded, deterministic
selection of facts from ``facts.json``. That keeps the prompt small, keeps the
claim space closed, and makes it possible to state exactly which facts were on
the table when a plan was produced.
"""

from __future__ import annotations

from dataclasses import dataclass

from maingott_reel.models import ClaimStatus, Fact, FactCategory, FactRegistry

#: Categories in the order they matter for a positioning advertisement.
CATEGORY_PRIORITY: tuple[FactCategory, ...] = (
    FactCategory.POSITIONING,
    FactCategory.CUSTOMER_JOURNEY,
    FactCategory.CHANNEL,
    FactCategory.AI,
    FactCategory.INTEGRATION,
    FactCategory.ANALYTICS,
    FactCategory.ARCHITECTURE,
    FactCategory.CAPABILITY,
    FactCategory.OPERATIONS,
    FactCategory.OTHER,
)

#: Statements outside this range are either fragments or unreadable walls.
MIN_STATEMENT_CHARS = 30
MAX_STATEMENT_CHARS = 260

#: Defaults for the size of the offered fact set.
DEFAULT_MAX_FACTS = 90
DEFAULT_MAX_PER_CATEGORY = 14


@dataclass(frozen=True)
class FactSelection:
    """The facts offered to the planner for one run."""

    facts: list[Fact]
    allow_targets: bool

    @property
    def fact_ids(self) -> list[str]:
        """Ids of the offered facts, in offer order."""
        return [fact.id for fact in self.facts]

    @property
    def target_fact_ids(self) -> list[str]:
        """Ids of the offered facts that describe design targets."""
        return [fact.id for fact in self.facts if fact.claim_status is ClaimStatus.TARGET]

    def render(self) -> str:
        """Render the facts as a compact, id-addressed block for the prompt."""
        lines = []
        for fact in self.facts:
            marker = " [TARGET — design goal, not an achieved result]"
            status = marker if fact.claim_status is ClaimStatus.TARGET else ""
            section = f" ({fact.section})" if fact.section else ""
            lines.append(f"{fact.id} [{fact.category.value}]{status}{section}: {fact.statement}")
        return "\n".join(lines)


def _is_usable(fact: Fact, allow_targets: bool) -> bool:
    """Whether a fact may be offered to the planner at all."""
    if fact.claim_status is ClaimStatus.UNSUPPORTED:
        return False
    if fact.claim_status is ClaimStatus.TARGET and not allow_targets:
        return False
    return MIN_STATEMENT_CHARS <= len(fact.statement) <= MAX_STATEMENT_CHARS


def select_facts(
    registry: FactRegistry,
    allow_targets: bool = False,
    max_facts: int = DEFAULT_MAX_FACTS,
    max_per_category: int = DEFAULT_MAX_PER_CATEGORY,
) -> FactSelection:
    """Pick the facts to offer the planner.

    Selection is deterministic: facts keep document order inside a category,
    categories are taken in advertising priority order, and both the per
    category and the overall budget are hard caps.

    Args:
        registry: the Phase 1 fact registry.
        allow_targets: include facts marked as design targets.
        max_facts: overall budget.
        max_per_category: budget per category.
    """
    chosen: list[Fact] = []
    for category in CATEGORY_PRIORITY:
        usable = [
            fact
            for fact in registry.by_category(category)
            if _is_usable(fact, allow_targets=allow_targets)
        ]
        chosen.extend(usable[:max_per_category])

    chosen.sort(key=lambda fact: registry.facts.index(fact))
    return FactSelection(facts=chosen[:max_facts], allow_targets=allow_targets)
