"""Journey planning: the search, what it returns, and the limits it runs under.

:func:`plan_journeys` answers "how do I get there leaving now",
:func:`plan_profile` answers "what are my options this morning", and
:func:`plan_arriving_by` answers "what is the last moment I can leave". All
three hand back :class:`Journey` objects made of :class:`Leg` objects.
"""

from __future__ import annotations

from layover.plan.backward import BackwardSearch, plan_arriving_by
from layover.plan.criteria import SearchOptions
from layover.plan.leg import Journey, Leg, LegKind
from layover.plan.profile import plan_journeys, plan_profile
from layover.plan.scan import JourneySearch, Label

__all__ = [
    "BackwardSearch",
    "Journey",
    "JourneySearch",
    "Label",
    "Leg",
    "LegKind",
    "SearchOptions",
    "plan_arriving_by",
    "plan_journeys",
    "plan_profile",
]
