"""Calendar dates, weekday masks and inclusive date ranges.

The engine never asks the operating system what day it is. Every function here
takes the dates it works on, which is what makes a plan reproducible: the same
query on the same feed answers the same way next year.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Iterable, Iterator, Optional

from layover.errors import Location, ServiceError

__all__ = [
    "DateRange",
    "WEEKDAY_NAMES",
    "days_between",
    "format_date",
    "mask_contains",
    "mask_names",
    "next_weekday",
    "parse_date",
    "parse_weekday",
    "weekday_mask",
]

WEEKDAY_NAMES = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")

_SHORT = {name[:3]: index for index, name in enumerate(WEEKDAY_NAMES)}


def parse_date(text: str, where: Optional[Location] = None) -> date:
    """Read ``"YYYY-MM-DD"`` or ``"YYYYMMDD"`` into a date."""
    if isinstance(text, date):
        return text
    if not isinstance(text, str):
        raise ServiceError("a date must be text, got %r" % (text,), where)
    cleaned = text.strip()
    try:
        if len(cleaned) == 8 and cleaned.isdigit():
            return date(int(cleaned[0:4]), int(cleaned[4:6]), int(cleaned[6:8]))
        return date.fromisoformat(cleaned)
    except ValueError as problem:
        raise ServiceError("cannot read %r as a date: %s" % (text, problem), where) from None


def format_date(day: date) -> str:
    """Render a date as ``"YYYY-MM-DD"``, the only form the package writes."""
    return day.isoformat()


def parse_weekday(text: str, where: Optional[Location] = None) -> int:
    """Read a weekday name or its first three letters into 0 for Monday."""
    cleaned = str(text).strip().lower()
    if cleaned in WEEKDAY_NAMES:
        return WEEKDAY_NAMES.index(cleaned)
    if cleaned in _SHORT:
        return _SHORT[cleaned]
    raise ServiceError("cannot read %r as a weekday" % (text,), where)


def weekday_mask(days: Iterable) -> int:
    """Pack weekdays into a seven bit mask, Monday in the lowest bit.

    Accepts names, three letter forms and plain integers, so a calendar can be
    written either way in a feed.
    """
    mask = 0
    for entry in days:
        index = entry if isinstance(entry, int) else parse_weekday(entry)
        if not 0 <= index <= 6:
            raise ServiceError("a weekday is 0 to 6, got %r" % (entry,))
        mask |= 1 << index
    return mask


def mask_contains(mask: int, day: date) -> bool:
    """Whether a weekday mask covers the weekday that ``day`` falls on."""
    return bool(mask & (1 << day.weekday()))


def mask_names(mask: int) -> tuple[str, ...]:
    """Return the weekday names a mask covers, Monday first."""
    return tuple(name for index, name in enumerate(WEEKDAY_NAMES) if mask & (1 << index))


def next_weekday(start: date, weekday: int, include_start: bool = True) -> date:
    """Return the first date on or after ``start`` that falls on ``weekday``."""
    if not 0 <= weekday <= 6:
        raise ServiceError("a weekday is 0 to 6, got %r" % (weekday,))
    ahead = (weekday - start.weekday()) % 7
    if ahead == 0 and not include_start:
        ahead = 7
    return start + timedelta(days=ahead)


def days_between(first: date, last: date) -> int:
    """How many days separate two dates, negative if they are the wrong way round."""
    return (last - first).days


@dataclass(frozen=True, order=True)
class DateRange:
    """A span of calendar dates with both ends included.

    Feeds write service periods this way, and a reader who sees ``2026-07-01``
    to ``2026-07-31`` expects the last of July to run.
    """

    start: date
    end: date

    def __post_init__(self) -> None:
        if self.end < self.start:
            raise ServiceError(
                "a date range ends before it starts: %s to %s"
                % (format_date(self.start), format_date(self.end))
            )

    def __len__(self) -> int:
        return (self.end - self.start).days + 1

    def __iter__(self) -> Iterator[date]:
        day = self.start
        while day <= self.end:
            yield day
            day += timedelta(days=1)

    def __contains__(self, day: object) -> bool:
        return isinstance(day, date) and self.start <= day <= self.end

    def __str__(self) -> str:
        return "%s..%s" % (format_date(self.start), format_date(self.end))

    def overlaps(self, other: "DateRange") -> bool:
        """Whether two ranges share any date."""
        return self.start <= other.end and other.start <= self.end

    def clip(self, other: "DateRange") -> Optional["DateRange"]:
        """Return the shared span of two ranges, or ``None`` if they miss."""
        if not self.overlaps(other):
            return None
        return DateRange(max(self.start, other.start), min(self.end, other.end))

    def widen(self, before: int = 0, after: int = 0) -> "DateRange":
        """Return the range stretched by whole days at either end."""
        return DateRange(self.start - timedelta(days=before), self.end + timedelta(days=after))

    def weekdays(self, mask: int) -> tuple[date, ...]:
        """Return the dates in the range whose weekday the mask covers."""
        return tuple(day for day in self if mask_contains(mask, day))

    @classmethod
    def parse(cls, text: str) -> "DateRange":
        """Read ``"2026-07-01..2026-07-31"`` into a range."""
        if ".." not in text:
            raise ServiceError("a date range looks like 2026-07-01..2026-07-31, got %r" % text)
        start, _, end = text.partition("..")
        return cls(parse_date(start), parse_date(end))

    @classmethod
    def of_month(cls, year: int, month: int) -> "DateRange":
        """Return the range covering a whole calendar month."""
        try:
            start = date(year, month, 1)
        except ValueError as problem:
            raise ServiceError("no such month: %s" % problem) from None
        if month == 12:
            end = date(year, 12, 31)
        else:
            end = date(year, month + 1, 1) - timedelta(days=1)
        return cls(start, end)

    @classmethod
    def around(cls, day: date, before: int = 0, after: int = 0) -> "DateRange":
        """Return a range spanning ``before`` and ``after`` days around a date."""
        return cls(day - timedelta(days=before), day + timedelta(days=after))
