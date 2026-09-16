"""Departure and arrival boards, the kind that hangs at a stop."""

from __future__ import annotations

from datetime import date
from typing import Iterable, Optional

from layover.dates import format_date
from layover.report.render import Report
from layover.timetable.table import Timetable
from layover.times import format_short

__all__ = ["arrival_board", "departure_board", "stop_summary"]


def departure_board(
    timetable: Timetable,
    stop_id: str,
    day: date,
    after: int = 0,
    limit: Optional[int] = 10,
    routes: Optional[Iterable[str]] = None,
) -> Report:
    """The next departures from a stop, one row each."""
    stop = timetable.network.stop(stop_id)
    entries = timetable.departures(stop_id, day, after, limit, routes)
    rows = []
    for entry in entries:
        rows.append(
            (
                format_short(entry.departure),
                timetable.network.route(entry.route_id).name,
                entry.headsign or entry.destination,
                entry.trip_id,
            )
        )
    notes = []
    if any(entry.from_yesterday for entry in entries):
        notes.append("Some services began the day before.")
    if not rows:
        notes.append("Nothing leaves here on this date.")
    return Report(
        "Departures from %s, %s" % (stop.label, format_date(day)),
        ("Time", "Route", "Towards", "Trip"),
        tuple(rows),
        tuple(notes),
    )


def arrival_board(
    timetable: Timetable,
    stop_id: str,
    day: date,
    after: int = 0,
    limit: Optional[int] = 10,
) -> Report:
    """The next arrivals at a stop, one row each."""
    stop = timetable.network.stop(stop_id)
    entries = timetable.arrivals(stop_id, day, after, limit)
    rows = tuple(
        (
            format_short(entry.arrival),
            timetable.network.route(entry.route_id).name,
            entry.pattern.origin,
            entry.trip_id,
        )
        for entry in entries
    )
    notes = () if rows else ("Nothing arrives here on this date.",)
    return Report(
        "Arrivals at %s, %s" % (stop.label, format_date(day)),
        ("Time", "Route", "From", "Trip"),
        rows,
        notes,
    )


def stop_summary(timetable: Timetable, day: date) -> Report:
    """Every stop, how many calls it sees and which routes serve it."""
    network = timetable.network
    rows = []
    for stop in network.stops():
        calls = timetable.calls_at(stop.stop_id, day)
        span = timetable.first_and_last(stop.stop_id, day)
        rows.append(
            (
                stop.stop_id,
                stop.name,
                str(len(calls)),
                ", ".join(network.routes_at(stop.stop_id)),
                "" if span is None else "%s-%s" % (format_short(span[0]), format_short(span[1])),
            )
        )
    return Report(
        "Stops on %s" % format_date(day),
        ("Stop", "Name", "Calls", "Routes", "Service"),
        tuple(rows),
        right=(2,),
    )
