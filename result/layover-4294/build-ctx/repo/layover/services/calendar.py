"""One service calendar: a weekly pattern, a period, and its exceptions.

Feeds write a calendar as seven weekday flags over a start and end date, then
patch single dates on top of it. A public holiday drops the weekday service and
adds the Sunday one, and both patches land on the same date, which is why the
exceptions are held apart from the pattern rather than folded into it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import FrozenSet, Iterable, Optional

from layover.dates import DateRange, format_date, mask_contains, mask_names, weekday_mask
from layover.errors import ServiceError

__all__ = ["ServiceCalendar"]


@dataclass(frozen=True)
class ServiceCalendar:
    """The days one service runs.

    ``weekdays`` is a seven bit mask with Monday in the lowest bit, ``period``
    is the span the pattern applies over, and the two exception sets add and
    drop single dates. A date that appears in both is dropped: removing is the
    stronger statement, and a feed that says both is telling us the service does
    not run.
    """

    service_id: str
    weekdays: int = 0
    period: Optional[DateRange] = None
    added: FrozenSet[date] = field(default_factory=frozenset)
    removed: FrozenSet[date] = field(default_factory=frozenset)

    def __post_init__(self) -> None:
        identifier = str(self.service_id).strip()
        if not identifier:
            raise ServiceError("a service needs an identifier")
        object.__setattr__(self, "service_id", identifier)
        if not 0 <= self.weekdays <= 0b1111111:
            raise ServiceError(
                "a weekday mask covers seven days, got %r" % (self.weekdays,)
            )
        if self.weekdays and self.period is None:
            raise ServiceError(
                "service %r has a weekly pattern but no period" % self.service_id
            )
        object.__setattr__(self, "added", frozenset(self.added))
        object.__setattr__(self, "removed", frozenset(self.removed))
        if not self.weekdays and not self.added:
            raise ServiceError("service %r never runs" % self.service_id)

    def runs_on(self, day: date) -> bool:
        """Whether the service runs on ``day``, exceptions taken into account."""
        if day in self.removed:
            return False
        if day in self.added:
            return True
        if self.period is None or day not in self.period:
            return False
        return mask_contains(self.weekdays, day)

    def active_dates(self) -> tuple[date, ...]:
        """Every date the service runs, in order."""
        days = set()
        if self.period is not None and self.weekdays:
            days.update(self.period.weekdays(self.weekdays))
        days.update(self.added)
        days.difference_update(self.removed)
        return tuple(sorted(days))

    @property
    def first_date(self) -> Optional[date]:
        """The first date the service runs, or ``None`` if it never does."""
        days = self.active_dates()
        return days[0] if days else None

    @property
    def last_date(self) -> Optional[date]:
        """The last date the service runs, or ``None`` if it never does."""
        days = self.active_dates()
        return days[-1] if days else None

    @property
    def span(self) -> Optional[DateRange]:
        """The range from the first running date to the last, or ``None``."""
        first, last = self.first_date, self.last_date
        if first is None or last is None:
            return None
        return DateRange(first, last)

    def count(self) -> int:
        """How many dates the service runs on."""
        return len(self.active_dates())

    @property
    def is_empty(self) -> bool:
        """Whether the calendar ends up covering no date at all."""
        return not self.active_dates()

    def weekday_names(self) -> tuple[str, ...]:
        """The weekdays the pattern covers, Monday first."""
        return mask_names(self.weekdays)

    def with_added(self, days: Iterable[date]) -> "ServiceCalendar":
        """Return the calendar with more dates added on top."""
        return ServiceCalendar(
            self.service_id,
            self.weekdays,
            self.period,
            self.added | frozenset(days),
            self.removed,
        )

    def with_removed(self, days: Iterable[date]) -> "ServiceCalendar":
        """Return the calendar with more dates dropped."""
        return ServiceCalendar(
            self.service_id,
            self.weekdays,
            self.period,
            self.added,
            self.removed | frozenset(days),
        )

    def renamed(self, service_id: str) -> "ServiceCalendar":
        """Return the same days under another identifier."""
        return ServiceCalendar(service_id, self.weekdays, self.period, self.added, self.removed)

    def clipped(self, window: DateRange) -> "ServiceCalendar":
        """Return the calendar restricted to ``window``.

        The result is written entirely as added dates, because clipping a
        weekly pattern to an arbitrary window is not itself a weekly pattern.
        """
        days = [day for day in self.active_dates() if day in window]
        if not days:
            raise ServiceError(
                "service %r runs on no date inside %s" % (self.service_id, window)
            )
        return ServiceCalendar(self.service_id, 0, None, frozenset(days), frozenset())

    def same_days_as(self, other: "ServiceCalendar") -> bool:
        """Whether two calendars cover exactly the same dates."""
        return self.active_dates() == other.active_dates()

    def __str__(self) -> str:
        return "%s (%d days)" % (self.service_id, self.count())

    @classmethod
    def weekly(
        cls,
        service_id: str,
        days: Iterable,
        period: DateRange,
        added: Iterable[date] = (),
        removed: Iterable[date] = (),
    ) -> "ServiceCalendar":
        """Build a calendar from weekday names or numbers rather than a mask."""
        return cls(service_id, weekday_mask(days), period, frozenset(added), frozenset(removed))

    @classmethod
    def on_dates(cls, service_id: str, days: Iterable[date]) -> "ServiceCalendar":
        """Build a calendar that runs on exactly the dates listed."""
        listed = frozenset(days)
        if not listed:
            raise ServiceError("service %r would run on no date" % service_id)
        return cls(service_id, 0, None, listed, frozenset())

    def describe_dates(self, limit: int = 3) -> str:
        """List the first few running dates, with a count of the rest."""
        days = self.active_dates()
        shown = ", ".join(format_date(day) for day in days[:limit])
        if len(days) <= limit:
            return shown or "never"
        return "%s and %d more" % (shown, len(days) - limit)
