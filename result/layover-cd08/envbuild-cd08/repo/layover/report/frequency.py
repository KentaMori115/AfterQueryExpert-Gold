"""Reports about how often things run rather than when."""

from __future__ import annotations

from datetime import date
from typing import Iterable, Optional

from layover.dates import format_date
from layover.report.render import Report
from layover.timetable.frequency import route_frequency, service_profile, stop_frequency
from layover.timetable.table import Timetable
from layover.times import SECONDS_PER_HOUR, TimeWindow, format_duration, format_short

__all__ = ["frequency_report", "profile_report", "route_frequency_report"]


def _gap(value: Optional[int]) -> str:
    return "" if value is None else format_duration(value)


def frequency_report(
    timetable: Timetable,
    day: date,
    window: TimeWindow,
    stops: Optional[Iterable[str]] = None,
) -> Report:
    """Every stop, how often something leaves it, and how even the gaps are."""
    wanted = list(stops) if stops is not None else list(timetable.network.stop_ids())
    rows = []
    for stop_id in wanted:
        stop = timetable.network.stop(stop_id)
        if stop.is_station:
            continue
        found = stop_frequency(timetable, stop_id, day, window)
        rows.append(
            (
                stop_id,
                stop.name,
                str(found.count),
                str(found.per_hour),
                _gap(found.mean_headway),
                _gap(found.longest_gap),
                "yes" if found.is_even() else "no",
            )
        )
    return Report(
        "Frequency at %s, %s" % (window, format_date(day)),
        ("Stop", "Name", "Departures", "Per hour", "Headway", "Worst wait", "Even"),
        tuple(rows),
        right=(2, 3),
    )


def route_frequency_report(timetable: Timetable, day: date, window: TimeWindow) -> Report:
    """Every route, how often it sets off, and in which direction."""
    rows = []
    for route in timetable.network.routes():
        for direction in (0, 1):
            found = route_frequency(timetable, route.route_id, day, window, direction)
            if not found.count:
                continue
            rows.append(
                (
                    route.name,
                    "out" if direction == 0 else "back",
                    str(found.count),
                    _gap(found.mean_headway),
                    _gap(found.longest_gap),
                )
            )
    notes = () if rows else ("Nothing runs inside this window.",)
    return Report(
        "Route frequency at %s, %s" % (window, format_date(day)),
        ("Route", "Direction", "Departures", "Headway", "Worst wait"),
        tuple(rows),
        notes,
        right=(2,),
    )


def profile_report(
    timetable: Timetable,
    stop_id: str,
    day: date,
    step: int = SECONDS_PER_HOUR,
) -> Report:
    """One row per slice of the day at one stop, quiet slices included."""
    stop = timetable.network.stop(stop_id)
    rows = []
    for found in service_profile(timetable, stop_id, day, None, step):
        rows.append(
            (
                format_short(found.window.start),
                str(found.count),
                "#" * found.count,
                _gap(found.mean_headway),
            )
        )
    return Report(
        "Service through the day at %s, %s" % (stop.name, format_date(day)),
        ("From", "Departures", "", "Headway"),
        tuple(rows),
        right=(1,),
    )
