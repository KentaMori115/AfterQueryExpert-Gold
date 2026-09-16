"""Building a network, its calendars and its fares out of raw tables.

The loader reads every table before it complains. A stop with an unreadable
position, a trip whose times run backwards and a rule naming a fare that does
not exist are all found in one pass, because the alternative is a feed author
fixing one line, running it again, and finding the next one.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from layover.dates import DateRange, WEEKDAY_NAMES, weekday_mask
from layover.errors import FeedError, LayoverError, Location
from layover.fares.cap import FareCap
from layover.fares.rules import FareProduct, FareRule
from layover.fares.table import FareTable
from layover.fares.zones import ZoneMap
from layover.feed.parse import Problems, RowReader
from layover.feed.reader import RawFeed
from layover.geo import Point
from layover.money import Money
from layover.network import (
    Agency,
    Network,
    NetworkBuilder,
    Pattern,
    Route,
    Stop,
    StopKind,
    Transfer,
    Trip,
)
from layover.services import ServiceCalendar, ServiceRegistry

__all__ = ["FeedContents", "load_feed", "load_with_problems"]


@dataclass(frozen=True)
class FeedContents:
    """Everything a feed holds, once it has been read and checked."""

    network: Network
    services: ServiceRegistry
    fares: Optional[FareTable] = None
    name: str = ""

    def zones(self) -> ZoneMap:
        """The fare zones of the network the feed described."""
        return ZoneMap.of_network(self.network)

    @property
    def has_fares(self) -> bool:
        """Whether the feed carried a fare table that can price anything."""
        return self.fares is not None and not self.fares.is_empty

    def counts(self) -> dict:
        """How much of everything the feed held."""
        counts = dict(self.network.counts())
        counts["services"] = len(self.services)
        counts["fares"] = 0 if self.fares is None else len(self.fares)
        return counts

    def summary(self) -> str:
        """A one line count, for a report header or the command line."""
        counts = self.counts()
        return ", ".join("%d %s" % (counts[key], key) for key in sorted(counts))

    def __str__(self) -> str:
        return "%s: %s" % (self.name or "feed", self.summary())


def load_feed(raw: RawFeed, name: str = "") -> FeedContents:
    """Read a feed, raising on the first problem and saying how many followed."""
    contents, problems = load_with_problems(raw, name)
    problems.raise_if_any()
    if contents is None:
        raise FeedError("the feed could not be read")
    return contents


def load_with_problems(
    raw: RawFeed, name: str = "", limit: Optional[int] = None
) -> Tuple[Optional[FeedContents], Problems]:
    """Read a feed and hand back everything that went wrong with it."""
    problems = Problems(limit)
    raw.check()
    builder = NetworkBuilder(name or raw.source)
    _load_agencies(raw, builder, problems)
    _load_stops(raw, builder, problems)
    _load_routes(raw, builder, problems)
    _load_patterns(raw, builder, problems)
    _load_trips(raw, builder, problems)
    _load_transfers(raw, builder, problems)
    services = _load_services(raw, problems)
    fares = _load_fares(raw, problems)
    try:
        network = builder.build()
    except LayoverError as problem:
        problems.add(problem)
        return None, problems
    return FeedContents(network, services, fares, name or raw.source), problems


def _load_agencies(raw: RawFeed, builder: NetworkBuilder, problems: Problems) -> None:
    for row in raw.rows("agencies"):
        reader = RowReader(row, problems)
        agency = reader.built(
            Agency,
            reader.text("agency_id"),
            reader.text("name"),
            reader.optional_text("url", "") or "",
            reader.optional_text("timezone", "") or "",
        )
        if agency is not None and not reader.failed:
            _add(builder.add_agency, agency, row, problems)


def _load_stops(raw: RawFeed, builder: NetworkBuilder, problems: Problems) -> None:
    for row in raw.rows("stops"):
        reader = RowReader(row, problems)
        stop_id = reader.text("stop_id")
        stop_name = reader.text("name")
        latitude = reader.optional_text("lat")
        longitude = reader.optional_text("lon")
        point = None
        if latitude is not None and longitude is not None:
            point = reader.built(Point.of, latitude, longitude, row.where("lat"))
        elif latitude is not None or longitude is not None:
            problems.note("a stop has one coordinate and not the other", row.where())
        kind = reader.built(StopKind.parse, reader.optional_text("kind", "") or "")
        stop = reader.built(
            Stop,
            stop_id,
            stop_name,
            point,
            reader.optional_text("parent"),
            kind or StopKind.STOP,
            reader.optional_text("zone"),
            reader.optional_text("code"),
            reader.optional_text("platform"),
        )
        if stop is not None and not reader.failed:
            _add(builder.add_stop, stop, row, problems)


def _load_routes(raw: RawFeed, builder: NetworkBuilder, problems: Problems) -> None:
    for row in raw.rows("routes"):
        reader = RowReader(row, problems)
        route = reader.built(
            Route,
            reader.text("route_id"),
            reader.optional_text("short_name", "") or "",
            reader.optional_text("long_name", "") or "",
            reader.optional_text("mode", "bus") or "bus",
            reader.optional_text("agency_id"),
            reader.optional_text("colour"),
        )
        if route is not None and not reader.failed:
            _add(builder.add_route, route, row, problems)


def _load_patterns(raw: RawFeed, builder: NetworkBuilder, problems: Problems) -> None:
    calls: Dict[str, List[tuple]] = {}
    for row in raw.rows("pattern_stops"):
        reader = RowReader(row, problems)
        pattern_id = reader.text("pattern_id")
        sequence = reader.integer("sequence")
        stop_id = reader.text("stop_id")
        pickup = reader.boolean("pickup", True)
        dropoff = reader.boolean("dropoff", True)
        if reader.failed:
            continue
        calls.setdefault(pattern_id, []).append((sequence, stop_id, pickup, dropoff))
    for row in raw.rows("patterns"):
        reader = RowReader(row, problems)
        pattern_id = reader.text("pattern_id")
        route_id = reader.text("route_id")
        direction = reader.optional_integer("direction", 0) or 0
        if reader.failed:
            continue
        listed = sorted(calls.pop(pattern_id, []))
        if not listed:
            problems.note("pattern %r has no stops" % pattern_id, row.where())
            continue
        if len({entry[0] for entry in listed}) != len(listed):
            problems.note("pattern %r repeats a sequence number" % pattern_id, row.where())
            continue
        pattern = reader.built(
            Pattern,
            pattern_id,
            route_id,
            tuple(entry[1] for entry in listed),
            tuple(entry[2] for entry in listed),
            tuple(entry[3] for entry in listed),
            reader.optional_text("headsign", "") or "",
            direction,
        )
        if pattern is not None and not reader.failed:
            _add(builder.add_pattern, pattern, row, problems)
    for pattern_id in sorted(calls):
        problems.note(
            "pattern_stops names pattern %r, which the patterns table does not" % pattern_id,
            Location("pattern_stops"),
        )


def _load_trips(raw: RawFeed, builder: NetworkBuilder, problems: Problems) -> None:
    times: Dict[str, List[tuple]] = {}
    for row in raw.rows("stop_times"):
        reader = RowReader(row, problems)
        trip_id = reader.text("trip_id")
        sequence = reader.integer("sequence")
        arrival = reader.clock("arrival")
        departure = reader.optional_clock("departure", arrival)
        if reader.failed:
            continue
        times.setdefault(trip_id, []).append((sequence, arrival, departure))
    for row in raw.rows("trips"):
        reader = RowReader(row, problems)
        trip_id = reader.text("trip_id")
        pattern_id = reader.text("pattern_id")
        service_id = reader.text("service_id")
        if reader.failed:
            continue
        listed = sorted(times.pop(trip_id, []))
        if not listed:
            problems.note("trip %r has no times" % trip_id, row.where())
            continue
        if len({entry[0] for entry in listed}) != len(listed):
            problems.note("trip %r repeats a sequence number" % trip_id, row.where())
            continue
        trip = reader.built(
            Trip,
            trip_id,
            pattern_id,
            service_id,
            tuple(entry[1] for entry in listed),
            tuple(entry[2] for entry in listed),
            reader.optional_text("headsign", "") or "",
            reader.optional_text("short_name", "") or "",
            reader.optional_text("block_id"),
        )
        if trip is not None and not reader.failed:
            _add(builder.add_trip, trip, row, problems)
    for trip_id in sorted(times):
        problems.note(
            "stop_times names trip %r, which the trips table does not" % trip_id,
            Location("stop_times"),
        )


def _load_transfers(raw: RawFeed, builder: NetworkBuilder, problems: Problems) -> None:
    for row in raw.rows("transfers"):
        reader = RowReader(row, problems)
        transfer = reader.built(
            Transfer,
            reader.text("from_stop"),
            reader.text("to_stop"),
            reader.integer("seconds"),
            reader.optional_text("kind", "walk") or "walk",
        )
        if transfer is not None and not reader.failed:
            builder.add_transfer(transfer)


def _load_services(raw: RawFeed, problems: Problems) -> ServiceRegistry:
    weekdays: Dict[str, tuple] = {}
    for row in raw.rows("calendars"):
        reader = RowReader(row, problems)
        service_id = reader.text("service_id")
        days = [name for name in WEEKDAY_NAMES if reader.boolean(name, False)]
        start = reader.date("start_date")
        end = reader.date("end_date")
        if reader.failed or start is None or end is None:
            continue
        period = reader.built(DateRange, start, end)
        if period is None:
            continue
        weekdays[service_id] = (weekday_mask(days), period)
    added: Dict[str, set] = {}
    removed: Dict[str, set] = {}
    for row in raw.rows("calendar_dates"):
        reader = RowReader(row, problems)
        service_id = reader.text("service_id")
        day = reader.date("date")
        exception = reader.choice("exception", ("add", "remove"), "add")
        if reader.failed or day is None:
            continue
        holder = added if exception == "add" else removed
        holder.setdefault(service_id, set()).add(day)
    registry = ServiceRegistry()
    for service_id in sorted(set(weekdays) | set(added) | set(removed)):
        mask, period = weekdays.get(service_id, (0, None))
        calendar = None
        try:
            calendar = ServiceCalendar(
                service_id,
                mask,
                period,
                frozenset(added.get(service_id, ())),
                frozenset(removed.get(service_id, ())),
            )
        except LayoverError as problem:
            problems.add(problem)
        if calendar is not None:
            try:
                registry.add(calendar)
            except LayoverError as problem:
                problems.add(problem)
    return registry


def _load_fares(raw: RawFeed, problems: Problems) -> Optional[FareTable]:
    if not raw.has("fare_products") and not raw.has("fare_caps"):
        return None
    products = []
    currency = "EUR"
    for row in raw.rows("fare_products"):
        reader = RowReader(row, problems)
        fare_id = reader.text("fare_id")
        price = reader.text("price")
        currency = reader.optional_text("currency", currency) or currency
        money = reader.built(Money, price, currency)
        product = reader.built(
            FareProduct,
            fare_id,
            money if money is not None else Money.zero(currency),
            reader.optional_integer("transfers"),
            reader.optional_integer("window"),
            reader.optional_text("name", "") or "",
        )
        if product is not None and not reader.failed:
            products.append(product)
    table = FareTable(currency=currency)
    for product in products:
        try:
            table.add_product(product)
        except LayoverError as problem:
            problems.add(problem)
    for row in raw.rows("fare_rules"):
        reader = RowReader(row, problems)
        rule = reader.built(
            FareRule,
            reader.text("fare_id"),
            reader.optional_text("from_zone"),
            reader.optional_text("to_zone"),
            reader.optional_text("route_id"),
        )
        if rule is None or reader.failed:
            continue
        try:
            table.add_rule(rule)
        except LayoverError as problem:
            problems.add(problem)
    _load_caps(raw, table, problems)
    return table


def _load_caps(raw: RawFeed, table: FareTable, problems: Problems) -> None:
    for row in raw.rows("fare_caps"):
        reader = RowReader(row, problems)
        cap_id = reader.text("cap_id")
        price = reader.text("price")
        currency = reader.optional_text("currency", table.currency) or table.currency
        money = reader.built(Money, price, currency)
        cap = reader.built(
            FareCap,
            cap_id,
            money if money is not None else Money.zero(currency),
            reader.text("period"),
            reader.optional_text("zone"),
            reader.optional_text("route_id"),
        )
        if cap is None or reader.failed:
            continue
        try:
            table.add_cap(cap)
        except LayoverError as problem:
            problems.add(problem)


def _add(take, value, row, problems: Problems) -> None:
    try:
        take(value)
    except LayoverError as problem:
        if problem.where is None:
            problem.where = row.where()
        problems.add(problem)
