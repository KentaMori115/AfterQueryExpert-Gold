"""Service calendars: which days a trip actually runs.

A timetable without a calendar is a wish. This package holds the weekly pattern,
the period it applies over and the exceptions that add or drop single dates, and
answers the one question the rest of the engine asks it: does this service run
on this date.
"""

from __future__ import annotations

from layover.services.calendar import ServiceCalendar
from layover.services.describe import describe_calendar, describe_registry
from layover.services.registry import ServiceRegistry

__all__ = [
    "ServiceCalendar",
    "ServiceRegistry",
    "describe_calendar",
    "describe_registry",
]
