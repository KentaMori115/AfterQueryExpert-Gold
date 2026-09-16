"""Reports: boards, printed timetables, itineraries and summaries.

Every builder returns a :class:`Report`, which renders as fixed width text, as a
markdown table or as comma separated rows. Nothing here decides anything; the
numbers come from the timetable and the plan.
"""

from __future__ import annotations

from layover.report.board import arrival_board, departure_board, stop_summary
from layover.report.diagram import diagram_report, line_diagram, route_diagrams
from layover.report.frequency import (
    frequency_report,
    profile_report,
    route_frequency_report,
)
from layover.report.journey import itinerary_report, journeys_report
from layover.report.render import Rendering, Report, align_columns, text_table
from layover.report.summary import (
    calendar_report,
    network_report,
    route_report_lines,
    service_day_report,
)
from layover.report.timetable import grid_report, pattern_report, route_report

__all__ = [
    "Rendering",
    "Report",
    "align_columns",
    "arrival_board",
    "calendar_report",
    "departure_board",
    "diagram_report",
    "frequency_report",
    "grid_report",
    "itinerary_report",
    "journeys_report",
    "line_diagram",
    "network_report",
    "pattern_report",
    "profile_report",
    "route_diagrams",
    "route_frequency_report",
    "route_report",
    "route_report_lines",
    "service_day_report",
    "stop_summary",
    "text_table",
]
