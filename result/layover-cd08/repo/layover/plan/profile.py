"""Range queries: not one journey but every one worth catching in a window.

A passenger who asks "how do I get there at half past eight" wants one answer. A
passenger who asks "what are my options this morning" wants the profile: the
journeys that leave at different times and are not all the same journey shifted.
This runs the search again from just after each journey it finds, which is the
plain way to do it and needs nothing the search does not already offer.
"""

from __future__ import annotations

from datetime import date
from typing import List, Optional

from layover.errors import PlanError
from layover.plan.criteria import SearchOptions
from layover.plan.leg import Journey
from layover.plan.scan import JourneySearch
from layover.timetable.table import Timetable
from layover.times import TimeWindow

__all__ = ["plan_journeys", "plan_profile"]


def plan_journeys(
    timetable: Timetable,
    origin: str,
    destination: str,
    day: date,
    after: int = 0,
    options: Optional[SearchOptions] = None,
) -> tuple[Journey, ...]:
    """Plan from one stop to another, leaving at or after a time."""
    return JourneySearch(timetable, options).plan(origin, destination, day, after)


def plan_profile(
    timetable: Timetable,
    origin: str,
    destination: str,
    day: date,
    window: TimeWindow,
    options: Optional[SearchOptions] = None,
    limit: int = 10,
) -> tuple[Journey, ...]:
    """Plan every journey leaving inside a window, earliest departure first.

    Each round of the search starts a second after the last journey left, so a
    journey is offered once however many later trains would also carry it.
    """
    if limit < 1:
        raise PlanError("a profile has to return at least one journey")
    settings = options or SearchOptions()
    settings = settings.with_window(max(settings.search_window, window.length))
    search = JourneySearch(timetable, settings)
    found: List[Journey] = []
    moment = window.start
    while moment < window.end and len(found) < limit:
        journeys = search.plan(origin, destination, day, moment)
        if not journeys:
            break
        best = min(journeys, key=lambda journey: (journey.departure, journey.arrival))
        if best.departure >= window.end:
            break
        for journey in sorted(journeys, key=lambda item: item.sort_key()):
            if journey.departure != best.departure:
                continue
            if journey not in found:
                found.append(journey)
        moment = best.departure + 1
    return tuple(sorted(found, key=lambda journey: (journey.departure, journey.arrival))[:limit])
