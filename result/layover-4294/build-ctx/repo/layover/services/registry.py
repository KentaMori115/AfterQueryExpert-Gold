"""Every service calendar in one place, indexed by date.

A search asks "which services run on this date" once per query and then reads
the answer thousands of times, so the registry keeps the answer rather than
recomputing it. The cache is filled on demand and never depends on anything
outside the calendars themselves.
"""

from __future__ import annotations

from datetime import date
from typing import Dict, Iterable, Iterator, Optional, Tuple

from layover.dates import DateRange
from layover.errors import ServiceError
from layover.services.calendar import ServiceCalendar

__all__ = ["ServiceRegistry"]


class ServiceRegistry:
    """A collection of service calendars, keyed by service identifier."""

    def __init__(self, calendars: Iterable[ServiceCalendar] = ()) -> None:
        self._calendars: Dict[str, ServiceCalendar] = {}
        self._by_date: Dict[date, Tuple[str, ...]] = {}
        for calendar in calendars:
            self.add(calendar)

    def add(self, calendar: ServiceCalendar) -> None:
        """Take on one calendar, refusing an identifier that is already used."""
        if not isinstance(calendar, ServiceCalendar):
            raise ServiceError("a registry holds calendars, got %r" % (calendar,))
        if calendar.service_id in self._calendars:
            raise ServiceError("service %r is defined twice" % calendar.service_id)
        self._calendars[calendar.service_id] = calendar
        self._by_date.clear()

    def get(self, service_id: str) -> ServiceCalendar:
        """Return one calendar, or raise if the identifier is unknown."""
        try:
            return self._calendars[service_id]
        except KeyError:
            raise ServiceError("no such service: %r" % (service_id,)) from None

    def find(self, service_id: str) -> Optional[ServiceCalendar]:
        """Return one calendar, or ``None`` if the identifier is unknown."""
        return self._calendars.get(service_id)

    def __contains__(self, service_id: object) -> bool:
        return service_id in self._calendars

    def __len__(self) -> int:
        return len(self._calendars)

    def __iter__(self) -> Iterator[ServiceCalendar]:
        for service_id in self.ids():
            yield self._calendars[service_id]

    def ids(self) -> tuple[str, ...]:
        """Every service identifier, sorted, so output never depends on insertion."""
        return tuple(sorted(self._calendars))

    def active_on(self, day: date) -> tuple[str, ...]:
        """Which services run on ``day``, sorted by identifier."""
        cached = self._by_date.get(day)
        if cached is None:
            cached = tuple(
                service_id
                for service_id in self.ids()
                if self._calendars[service_id].runs_on(day)
            )
            self._by_date[day] = cached
        return cached

    def runs_on(self, service_id: str, day: date) -> bool:
        """Whether one named service runs on ``day``."""
        return self.get(service_id).runs_on(day)

    def dates_covered(self) -> tuple[date, ...]:
        """Every date on which at least one service runs, in order."""
        days: set = set()
        for calendar in self._calendars.values():
            days.update(calendar.active_dates())
        return tuple(sorted(days))

    def span(self) -> Optional[DateRange]:
        """The range from the first date served to the last, or ``None``."""
        days = self.dates_covered()
        if not days:
            return None
        return DateRange(days[0], days[-1])

    def busiest_date(self) -> Optional[date]:
        """The date with the most services running, earliest one on a tie."""
        best: Optional[date] = None
        best_count = -1
        for day in self.dates_covered():
            count = len(self.active_on(day))
            if count > best_count:
                best, best_count = day, count
        return best

    def empty_services(self) -> tuple[str, ...]:
        """Services whose calendar covers no date at all."""
        return tuple(
            service_id
            for service_id in self.ids()
            if self._calendars[service_id].is_empty
        )

    def duplicates(self) -> tuple[tuple[str, ...], ...]:
        """Groups of services that run on exactly the same dates."""
        groups: Dict[tuple, list] = {}
        for calendar in self:
            groups.setdefault(calendar.active_dates(), []).append(calendar.service_id)
        return tuple(
            tuple(names)
            for _, names in sorted(groups.items(), key=lambda item: item[1][0])
            if len(names) > 1
        )

    def subset(self, service_ids: Iterable[str]) -> "ServiceRegistry":
        """Return a registry holding only the services named."""
        return ServiceRegistry(self.get(service_id) for service_id in sorted(set(service_ids)))

    def clipped(self, window: DateRange) -> "ServiceRegistry":
        """Return a registry with every calendar cut down to ``window``.

        Services that run on no date inside the window are left out rather than
        kept as empty calendars.
        """
        kept = []
        for calendar in self:
            if any(day in window for day in calendar.active_dates()):
                kept.append(calendar.clipped(window))
        return ServiceRegistry(kept)

    def merge(self, other: "ServiceRegistry") -> "ServiceRegistry":
        """Return the two registries side by side, refusing a shared identifier."""
        merged = ServiceRegistry(self)
        for calendar in other:
            merged.add(calendar)
        return merged

    def __str__(self) -> str:
        return "%d services" % len(self)
