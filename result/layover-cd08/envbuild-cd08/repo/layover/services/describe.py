"""Service calendars written out the way a timetable footnote writes them.

A calendar is a mask, a period and two sets of dates. A passenger reads "Mon-Fri
until 31 July, not 14 July", so this module turns one into the other. It is used
by reports and by the command line, and never by the engine.
"""

from __future__ import annotations

from datetime import date
from typing import Iterable, Sequence

from layover.dates import WEEKDAY_NAMES, format_date, mask_names
from layover.services.calendar import ServiceCalendar

__all__ = ["describe_calendar", "describe_registry", "describe_weekdays"]

_SHORT = {name: name[:3].capitalize() for name in WEEKDAY_NAMES}


def describe_weekdays(mask: int) -> str:
    """Render a weekday mask as ``"Mon-Fri"``, ``"Sat, Sun"`` or ``"daily"``."""
    names = mask_names(mask)
    if not names:
        return "no weekday"
    if len(names) == 7:
        return "daily"
    indexes = [WEEKDAY_NAMES.index(name) for name in names]
    runs = []
    start = previous = indexes[0]
    for index in indexes[1:]:
        if index == previous + 1:
            previous = index
            continue
        runs.append((start, previous))
        start = previous = index
    runs.append((start, previous))
    parts = []
    for first, last in runs:
        if first == last:
            parts.append(_SHORT[WEEKDAY_NAMES[first]])
        elif last == first + 1:
            parts.append("%s, %s" % (_SHORT[WEEKDAY_NAMES[first]], _SHORT[WEEKDAY_NAMES[last]]))
        else:
            parts.append("%s-%s" % (_SHORT[WEEKDAY_NAMES[first]], _SHORT[WEEKDAY_NAMES[last]]))
    return ", ".join(parts)


def _dates(days: Iterable[date], limit: int) -> str:
    listed: Sequence[date] = sorted(days)
    shown = ", ".join(format_date(day) for day in listed[:limit])
    if len(listed) > limit:
        shown += " and %d more" % (len(listed) - limit)
    return shown


def describe_calendar(calendar: ServiceCalendar, limit: int = 3) -> str:
    """Render one calendar as a sentence, exceptions included."""
    parts = []
    if calendar.weekdays and calendar.period is not None:
        parts.append("%s, %s" % (describe_weekdays(calendar.weekdays), calendar.period))
    elif calendar.added:
        parts.append("on %s" % _dates(calendar.added, limit))
    if calendar.added and calendar.weekdays:
        parts.append("also %s" % _dates(calendar.added, limit))
    if calendar.removed:
        parts.append("not %s" % _dates(calendar.removed, limit))
    return "; ".join(parts) if parts else "never"


def describe_registry(registry, limit: int = 3) -> tuple[str, ...]:
    """Render every calendar in a registry, one line each, sorted by identifier."""
    return tuple(
        "%s: %s" % (calendar.service_id, describe_calendar(calendar, limit))
        for calendar in registry
    )
