"""The timetable: what runs on a given date, and when it calls.

:class:`Timetable` puts a network and its calendars together and answers by
date. :func:`pattern_grid` lays a pattern's trips out the way a printed
timetable does.
"""

from __future__ import annotations

from layover.timetable.board import BoardEntry
from layover.timetable.frequency import (
    Frequency,
    busiest_window,
    route_frequency,
    service_profile,
    stop_frequency,
)
from layover.timetable.grid import Grid, pattern_grid, route_grids
from layover.timetable.table import Timetable

__all__ = [
    "BoardEntry",
    "Frequency",
    "Grid",
    "Timetable",
    "busiest_window",
    "pattern_grid",
    "route_frequency",
    "route_grids",
    "service_profile",
    "stop_frequency",
]
