"""Printed timetables: a pattern's stops down the side, its trips across."""

from __future__ import annotations

from datetime import date
from typing import Optional

from layover.dates import format_date
from layover.report.render import Report
from layover.timetable.grid import Grid, pattern_grid, route_grids
from layover.timetable.table import Timetable
from layover.times import TimeWindow

__all__ = ["grid_report", "pattern_report", "route_report"]


def grid_report(timetable: Timetable, grid: Grid, day: date, title: str = "") -> Report:
    """Render one grid as a report, a column per trip."""
    network = timetable.network
    route = network.route(grid.route_id)
    headers = ("Stop",) + tuple(str(index + 1) for index in range(len(grid.trips)))
    rows = []
    for index, stop_id in enumerate(grid.stops):
        stop = network.stop(stop_id)
        rows.append((stop.name,) + grid.as_text_rows()[index])
    notes = []
    if grid.headsign:
        notes.append("Towards %s." % grid.headsign)
    if grid.is_empty:
        notes.append("Nothing runs on this date.")
    return Report(
        title or "%s %s, %s" % (route.mode, route.name, format_date(day)),
        headers,
        tuple(rows),
        tuple(notes),
        right=tuple(range(1, len(headers))),
    )


def pattern_report(
    timetable: Timetable,
    pattern_id: str,
    day: date,
    window: Optional[TimeWindow] = None,
    limit: Optional[int] = None,
) -> Report:
    """The timetable of one pattern on a date."""
    grid = pattern_grid(timetable, pattern_id, day, window, limit)
    return grid_report(timetable, grid, day)


def route_report(
    timetable: Timetable,
    route_id: str,
    day: date,
    window: Optional[TimeWindow] = None,
) -> tuple[Report, ...]:
    """One report per pattern of a route, in pattern order."""
    return tuple(
        grid_report(timetable, grid, day) for grid in route_grids(timetable, route_id, day, window)
    )
