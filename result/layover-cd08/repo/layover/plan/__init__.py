"""Journey planning: the search, what it returns, and the limits it runs under.

:func:`plan_journeys` answers "how do I get there leaving now", and
:func:`plan_profile` answers "what are my options this morning". Both hand back
:class:`Journey` objects made of :class:`Leg` objects.
"""

from __future__ import annotations

from layover.plan.criteria import SearchOptions
from layover.plan.leg import Journey, Leg, LegKind
from layover.plan.profile import plan_journeys, plan_profile
from layover.plan.scan import JourneySearch, Label

__all__ = [
    "Journey",
    "JourneySearch",
    "Label",
    "Leg",
    "LegKind",
    "SearchOptions",
    "plan_journeys",
    "plan_profile",
]
