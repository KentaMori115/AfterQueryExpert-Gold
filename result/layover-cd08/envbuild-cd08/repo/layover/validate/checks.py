"""The checks themselves, each one a function over a loaded feed.

Every check is registered by name and can be run on its own, which is what makes
them testable: a check that fires on a network built to trip it, and stays quiet
on one built not to. None of them change anything.
"""

from __future__ import annotations

from typing import Callable, Dict, Iterator, List, Optional

from layover.geo import distance_metres
from layover.network.graph import components, neighbours
from layover.times import SECONDS_PER_HOUR, format_duration
from layover.validate.finding import Finding, Severity

__all__ = ["CHECKS", "check_named", "check_names", "describe_checks", "register"]

CHECKS: Dict[str, Callable] = {}
_NOTES: Dict[str, str] = {}

FAST_METRES_PER_HOUR = 200_000
WALK_METRES_PER_HOUR = 7_000
LONG_DWELL_SECONDS = 20 * 60
LONG_TRANSFER_SECONDS = 30 * 60


def register(name: str, note: str):
    """Register a check under a name, with a line saying what it looks for."""

    def take(function: Callable) -> Callable:
        if name in CHECKS:
            raise KeyError("check %r is registered twice" % name)
        CHECKS[name] = function
        _NOTES[name] = note
        return function

    return take


def check_names() -> tuple[str, ...]:
    """Every check, sorted."""
    return tuple(sorted(CHECKS))


def check_named(name: str) -> Callable:
    """Return one check, raising if the name is unknown."""
    try:
        return CHECKS[name]
    except KeyError:
        raise KeyError("no such check: %r" % (name,)) from None


def describe_checks() -> tuple[tuple[str, str], ...]:
    """Every check with its note, sorted by name."""
    return tuple((name, _NOTES[name]) for name in check_names())


def _finding(check, severity, message, subject="") -> Finding:
    return Finding(check, severity, message, subject)


@register("unused-stops", "stops that no pattern calls at")
def unused_stops(contents) -> Iterator[Finding]:
    """Report stops nothing calls at, stations aside."""
    network = contents.network
    for stop in network.stops():
        if stop.is_station or not stop.boardable:
            continue
        if not network.patterns_at(stop.stop_id):
            yield _finding(
                "unused-stops", Severity.WARNING, "no pattern calls at this stop", stop.stop_id
            )


@register("empty-patterns", "patterns with no trip on any date")
def empty_patterns(contents) -> Iterator[Finding]:
    """Report patterns that no trip ever runs."""
    network = contents.network
    for pattern in network.patterns():
        if not network.trips_of_pattern(pattern.pattern_id):
            yield _finding(
                "empty-patterns", Severity.WARNING, "no trip runs this pattern", pattern.pattern_id
            )


@register("unknown-services", "trips whose service has no calendar")
def unknown_services(contents) -> Iterator[Finding]:
    """Report trips pointing at a service the calendars do not define."""
    for service_id in contents.network.service_ids():
        if service_id not in contents.services:
            yield _finding(
                "unknown-services",
                Severity.ERROR,
                "trips run under a service with no calendar",
                service_id,
            )


@register("empty-calendars", "calendars that cover no date")
def empty_calendars(contents) -> Iterator[Finding]:
    """Report calendars whose exceptions cancel every date they had."""
    for service_id in contents.services.empty_services():
        yield _finding(
            "empty-calendars", Severity.WARNING, "this service runs on no date", service_id
        )


@register("duplicate-calendars", "services that run on exactly the same dates")
def duplicate_calendars(contents) -> Iterator[Finding]:
    """Report services that could be one service."""
    for group in contents.services.duplicates():
        yield _finding(
            "duplicate-calendars",
            Severity.NOTICE,
            "these services run on the same dates: %s" % ", ".join(group),
            group[0],
        )


@register("unused-services", "calendars no trip refers to")
def unused_services(contents) -> Iterator[Finding]:
    """Report calendars nothing runs under."""
    used = set(contents.network.service_ids())
    for service_id in contents.services.ids():
        if service_id not in used:
            yield _finding(
                "unused-services", Severity.NOTICE, "no trip runs under this service", service_id
            )


@register("missing-positions", "stops with no coordinates")
def missing_positions(contents) -> Iterator[Finding]:
    """Report stops that cannot be put on a map."""
    for stop in contents.network.stops():
        if stop.point is None:
            yield _finding(
                "missing-positions", Severity.NOTICE, "this stop has no position", stop.stop_id
            )


@register("fast-hops", "hops between calls that imply an impossible speed")
def fast_hops(contents) -> Iterator[Finding]:
    """Report a leg of a trip that would need an implausible speed."""
    network = contents.network
    for trip in network.trips():
        pattern = network.pattern(trip.pattern_id)
        for index in range(len(pattern) - 1):
            first = network.stop(pattern.stops[index])
            second = network.stop(pattern.stops[index + 1])
            if first.point is None or second.point is None:
                continue
            seconds = trip.arrivals[index + 1] - trip.departures[index]
            if seconds <= 0:
                continue
            metres = distance_metres(first.point, second.point)
            speed = metres * SECONDS_PER_HOUR // seconds
            if speed > FAST_METRES_PER_HOUR:
                yield _finding(
                    "fast-hops",
                    Severity.WARNING,
                    "%s to %s covers %d m in %s"
                    % (first.stop_id, second.stop_id, metres, format_duration(seconds)),
                    trip.trip_id,
                )


@register("standing-hops", "calls a trip reaches at the moment it left the last one")
def standing_hops(contents) -> Iterator[Finding]:
    """Report a hop that takes no time at all."""
    network = contents.network
    for trip in network.trips():
        for index in range(len(trip) - 1):
            if trip.arrivals[index + 1] == trip.departures[index]:
                yield _finding(
                    "standing-hops",
                    Severity.NOTICE,
                    "the hop from call %d takes no time" % (index + 1),
                    trip.trip_id,
                )


@register("long-dwells", "vehicles standing at a stop for a long time")
def long_dwells(contents) -> Iterator[Finding]:
    """Report a vehicle standing longer than a passenger would expect."""
    for trip in contents.network.trips():
        for index in range(len(trip)):
            dwell = trip.dwell_at(index)
            if dwell > LONG_DWELL_SECONDS:
                yield _finding(
                    "long-dwells",
                    Severity.NOTICE,
                    "stands %s at call %d" % (format_duration(dwell), index + 1),
                    trip.trip_id,
                )


@register("duplicate-trips", "trips running the same pattern at the same times")
def duplicate_trips(contents) -> Iterator[Finding]:
    """Report two trips that are the same journey written twice."""
    seen: Dict[tuple, str] = {}
    for trip in contents.network.trips():
        key = (trip.pattern_id, trip.service_id, trip.departures, trip.arrivals)
        if key in seen:
            yield _finding(
                "duplicate-trips",
                Severity.WARNING,
                "identical to trip %s" % seen[key],
                trip.trip_id,
            )
        else:
            seen[key] = trip.trip_id


@register("overtaking-trips", "trips on one pattern that pass each other")
def overtaking_trips(contents) -> Iterator[Finding]:
    """Report a pattern where a later trip arrives before an earlier one.

    Nothing breaks, but a passenger reading the column of departure times will
    not believe it, and a search that boards the first departure is no longer
    boarding the first arrival.
    """
    network = contents.network
    for pattern in network.patterns():
        trips = network.trips_of_pattern(pattern.pattern_id)
        for first, second in zip(trips, trips[1:]):
            for index in range(len(pattern)):
                if second.arrivals[index] < first.arrivals[index]:
                    yield _finding(
                        "overtaking-trips",
                        Severity.NOTICE,
                        "trip %s passes trip %s before call %d"
                        % (second.trip_id, first.trip_id, index + 1),
                        pattern.pattern_id,
                    )
                    break


@register("long-transfers", "declared transfers that take a long walk")
def long_transfers(contents) -> Iterator[Finding]:
    """Report a transfer nobody would make on foot."""
    for transfer in contents.network.transfers():
        if transfer.seconds > LONG_TRANSFER_SECONDS:
            yield _finding(
                "long-transfers",
                Severity.NOTICE,
                "takes %s" % format_duration(transfer.seconds),
                "%s to %s" % transfer.pair,
            )


@register("impossible-transfers", "transfers quicker than the walk between the stops")
def impossible_transfers(contents) -> Iterator[Finding]:
    """Report a transfer time that nobody could actually walk."""
    network = contents.network
    for transfer in network.transfers():
        first = network.stop(transfer.from_stop)
        second = network.stop(transfer.to_stop)
        if first.point is None or second.point is None or transfer.seconds <= 0:
            continue
        metres = distance_metres(first.point, second.point)
        speed = metres * SECONDS_PER_HOUR // transfer.seconds
        if speed > WALK_METRES_PER_HOUR:
            yield _finding(
                "impossible-transfers",
                Severity.WARNING,
                "%d m in %s is faster than walking"
                % (metres, format_duration(transfer.seconds)),
                "%s to %s" % transfer.pair,
            )


@register("unzoned-stops", "stops with no fare zone, when the feed has fares")
def unzoned_stops(contents) -> Iterator[Finding]:
    """Report stops a fare cannot be worked out for."""
    if not getattr(contents, "has_fares", False):
        return
    zones = contents.zones()
    for stop in contents.network.stops():
        if stop.is_station:
            continue
        if stop.stop_id not in zones and contents.network.patterns_at(stop.stop_id):
            yield _finding(
                "unzoned-stops", Severity.WARNING, "this stop is in no fare zone", stop.stop_id
            )


@register("uncovered-fares", "zone pairs no fare rule prices")
def uncovered_fares(contents) -> Iterator[Finding]:
    """Report a pair of zones a passenger could travel between but not pay for."""
    if not getattr(contents, "has_fares", False):
        return
    table = contents.fares
    zones = contents.zones()
    names = zones.zones()
    for origin in names:
        for target in names:
            covered = any(
                table.match(origin, target, route.route_id) is not None
                for route in contents.network.routes()
            )
            if not covered:
                yield _finding(
                    "uncovered-fares",
                    Severity.WARNING,
                    "no fare covers a journey from %s to %s" % (origin, target),
                    "%s-%s" % (origin, target),
                )


@register("unused-fares", "fare products no rule selects")
def unused_fares(contents) -> Iterator[Finding]:
    """Report a fare product nothing can ever sell."""
    if contents.fares is None:
        return
    for fare_id in contents.fares.unused_products():
        yield _finding(
            "unused-fares", Severity.NOTICE, "no rule selects this fare", fare_id
        )


@register("service-gaps", "dates inside the service period with nothing running")
def service_gaps(contents) -> Iterator[Finding]:
    """Report a date in the middle of the timetable where nothing runs."""
    span = contents.services.span()
    if span is None:
        return
    covered = set(contents.services.dates_covered())
    for day in span:
        if day not in covered:
            yield _finding(
                "service-gaps", Severity.NOTICE, "nothing runs on this date", day.isoformat()
            )


@register("split-network", "groups of stops that never connect to the rest")
def split_network(contents) -> Iterator[Finding]:
    """Report a feed that is really two networks in one file.

    The largest group is taken as the network proper and everything else is
    reported, smallest last, with the stops that make it up.
    """
    groups = components(contents.network)
    for group in groups[1:]:
        yield _finding(
            "split-network",
            Severity.WARNING,
            "these %d stops never connect to the rest of the network: %s"
            % (len(group), ", ".join(group[:5])),
            group[0],
        )


@register("dead-ends", "stops a vehicle reaches and never leaves")
def dead_ends(contents) -> Iterator[Finding]:
    """Report a stop that can be arrived at but never left.

    The last stop of an out and back route is fine, because the return pattern
    leaves from it. A stop with no way out at all strands a passenger.
    """
    network = contents.network
    for stop in network.stops():
        if stop.is_station or not network.patterns_at(stop.stop_id):
            continue
        if not neighbours(network, stop.stop_id):
            yield _finding(
                "dead-ends", Severity.WARNING, "nothing leaves this stop", stop.stop_id
            )
