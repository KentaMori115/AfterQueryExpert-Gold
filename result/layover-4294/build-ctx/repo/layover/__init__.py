"""layover, a timetable and journey planning engine for scheduled transport.

Read a feed of tables, build an immutable network, ask it what leaves a stop and
how to get across town. Standard library only, no clocks inside the engine, and
the same query always answers the same way.

    from datetime import date
    from layover import Session
    session = Session.demo()
    print(session.board("westtor", date(2026, 7, 15)).as_text())

The pieces underneath are all usable on their own: ``layover.feed`` reads the
tables, ``layover.network`` holds them, ``layover.timetable`` reads that through
a date, ``layover.plan`` searches it and ``layover.report`` prints the answer.
"""

from __future__ import annotations

from layover.errors import LayoverError, Location
from layover.money import Money
from layover.plan.criteria import SearchOptions
from layover.plan.leg import Journey, Leg
from layover.report.render import Report
from layover.session import Session
from layover.times import TimeWindow, format_clock, parse_clock

__all__ = [
    "Journey",
    "LayoverError",
    "Leg",
    "Location",
    "Money",
    "Report",
    "SearchOptions",
    "Session",
    "TimeWindow",
    "__version__",
    "format_clock",
    "parse_clock",
]

__version__ = "0.9.0"
