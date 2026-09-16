"""What a feed holds, counted up: modes, routes, service days, busiest stops."""

from __future__ import annotations

from datetime import date
from typing import Optional

from layover.dates import format_date
from layover.report.render import Report
from layover.services.describe import describe_calendar
from layover.timetable.table import Timetable
from layover.times import format_short

__all__ = ["calendar_report", "network_report", "route_report_lines", "service_day_report"]


def network_report(timetable: Timetable) -> Report:
    """One row per count: how much of everything the network holds."""
    counts = timetable.network.counts()
    rows = [(name, str(counts[name])) for name in sorted(counts)]
    rows.append(("services", str(len(timetable.services))))
    span = timetable.services.span()
    notes = []
    if span is not None:
        notes.append("Service runs %s." % span)
    modes = sorted({str(route.mode) for route in timetable.network.routes()})
    if modes:
        notes.append("Modes: %s." % ", ".join(modes))
    return Report(
        timetable.network.name or "Network",
        ("Thing", "Count"),
        tuple(rows),
        tuple(notes),
        right=(1,),
    )


def route_report_lines(timetable: Timetable, day: date) -> Report:
    """Every route, with its mode, its patterns and how many trips run."""
    network = timetable.network
    rows = []
    for route in network.routes():
        patterns = network.patterns_of_route(route.route_id)
        trips = sum(len(timetable.trips_on(day, pattern_id)) for pattern_id in patterns)
        rows.append(
            (
                route.route_id,
                route.name,
                str(route.mode),
                str(len(patterns)),
                str(trips),
            )
        )
    return Report(
        "Routes on %s" % format_date(day),
        ("Route", "Name", "Mode", "Patterns", "Trips"),
        tuple(rows),
        right=(3, 4),
    )


def service_day_report(timetable: Timetable, day: date) -> Report:
    """What runs on one date: routes, trips and the first and last departures."""
    network = timetable.network
    rows = []
    for route_id in timetable.routes_running(day):
        trips = [
            trip
            for pattern_id in network.patterns_of_route(route_id)
            for trip in timetable.trips_on(day, pattern_id)
        ]
        if not trips:
            continue
        first = min(trip.start_time for trip in trips)
        last = max(trip.start_time for trip in trips)
        rows.append(
            (
                network.route(route_id).name,
                str(len(trips)),
                format_short(first),
                format_short(last),
            )
        )
    notes = () if rows else ("Nothing runs on this date.",)
    return Report(
        "Service on %s" % format_date(day),
        ("Route", "Trips", "First", "Last"),
        tuple(rows),
        notes,
        right=(1,),
    )


def calendar_report(timetable: Timetable, limit: int = 3) -> Report:
    """Every service calendar, written out as a footnote would write it."""
    rows = []
    for calendar in timetable.services:
        rows.append(
            (
                calendar.service_id,
                str(calendar.count()),
                describe_calendar(calendar, limit),
            )
        )
    span = timetable.services.span()
    notes = () if span is None else ("Covering %s." % span,)
    return Report("Calendars", ("Service", "Days", "Runs"), tuple(rows), notes, right=(1,))
