"""What each subcommand does, as a function from arguments to text.

Every command returns an exit code and the lines to print, so the whole command
line can be tested without a subprocess and without capturing standard output.
"""

from __future__ import annotations

from datetime import date
from typing import List, Optional, Tuple

from layover.cli.args import UsageError
from layover.cli.exits import FAILED, NOTHING_FOUND, OK
from layover.dates import parse_date
from layover.demo.city import DEMO_DATE, demo_contents
from layover.errors import LayoverError
from layover.feed.load import load_feed
from layover.feed.reader import read_directory
from layover.feed.writer import write_feed
from layover.plan.criteria import SearchOptions
from layover.report.render import Rendering
from layover.session import Session
from layover.times import TimeWindow, parse_clock

__all__ = ["open_session", "run_command", "when"]

Result = Tuple[int, str]


def open_session(arguments) -> Session:
    """Open the session the arguments ask for, or the demo if they do not."""
    if arguments.feed and arguments.document:
        raise UsageError("read a feed or a document, not both")
    options = SearchOptions()
    changes = getattr(arguments, "changes", None)
    if changes is not None:
        options = options.with_transfers(changes)
    if arguments.feed:
        return Session(load_feed(read_directory(arguments.feed)), options)
    if arguments.document:
        return Session.from_document(arguments.document, options=options)
    return Session(demo_contents(), options)


def when(arguments, fallback: Optional[date] = None) -> date:
    """The date the arguments ask about, falling back to the demo's own date."""
    if arguments.date:
        return parse_date(arguments.date)
    return fallback or DEMO_DATE


def run_command(arguments) -> Result:
    """Run one subcommand and hand back its exit code and its output."""
    command = arguments.command
    handler = _HANDLERS.get(command)
    if handler is None:
        raise UsageError("no such command: %r" % (command,))
    return handler(arguments)


def _render(arguments, report) -> str:
    return report.render(Rendering.parse(arguments.format))


def _board(arguments) -> Result:
    session = open_session(arguments)
    report = session.board(
        arguments.stop,
        when(arguments),
        parse_clock(arguments.after),
        arguments.limit,
        arguments.routes,
    )
    return (OK if report.rows else NOTHING_FOUND, _render(arguments, report))


def _arrivals(arguments) -> Result:
    session = open_session(arguments)
    report = session.arrival_board(
        arguments.stop, when(arguments), parse_clock(arguments.after), arguments.limit
    )
    return (OK if report.rows else NOTHING_FOUND, _render(arguments, report))


def _plan(arguments) -> Result:
    session = open_session(arguments)
    day = when(arguments)
    if arguments.window:
        journeys = session.plan_window(
            arguments.origin, arguments.destination, day, TimeWindow.parse(arguments.window)
        )
    else:
        journeys = session.plan(
            arguments.origin, arguments.destination, day, parse_clock(arguments.after)
        )
    if not journeys:
        return (NOTHING_FOUND, "No journey was found.")
    if arguments.itinerary:
        parts = [
            _render(arguments, session.itinerary(journey, arguments.fare))
            for journey in journeys
        ]
        return (OK, "\n\n".join(parts))
    report = session.journeys_report(journeys)
    if arguments.fare and session.fares is not None:
        report = report.with_notes(
            ["Cheapest fare %s." % min(session.price(journey).total for journey in journeys)]
        )
    return (OK, _render(arguments, report))


def _timetable(arguments) -> Result:
    session = open_session(arguments)
    day = when(arguments)
    window = TimeWindow.parse(arguments.window) if arguments.window else None
    if arguments.pattern:
        report = session.pattern_timetable(arguments.pattern, day, window)
        return (OK if report.rows else NOTHING_FOUND, _render(arguments, report))
    if not arguments.route:
        raise UsageError("name a route, or use --pattern")
    reports = session.route_timetable(arguments.route, day, window)
    if not reports:
        return (NOTHING_FOUND, "That route has no patterns.")
    return (OK, "\n\n".join(_render(arguments, report) for report in reports))


def _diagram(arguments) -> Result:
    session = open_session(arguments)
    if arguments.pattern:
        return (OK, _render(arguments, session.diagram(arguments.pattern)))
    if not arguments.route:
        raise UsageError("name a route, or use --pattern")
    reports = session.route_diagram(arguments.route)
    return (OK, "\n\n".join(_render(arguments, report) for report in reports))


def _frequency(arguments) -> Result:
    session = open_session(arguments)
    day = when(arguments)
    if arguments.stop:
        report = session.profile(arguments.stop, day, arguments.step)
    elif arguments.routes:
        report = session.route_frequency(day, TimeWindow.parse(arguments.window))
    else:
        report = session.frequency(day, TimeWindow.parse(arguments.window))
    return (OK if report.rows else NOTHING_FOUND, _render(arguments, report))


def _check(arguments) -> Result:
    session = open_session(arguments)
    findings = session.check(arguments.only, arguments.skip)
    report = findings.as_report()
    return (FAILED if findings.errors else OK, _render(arguments, report))


def _routes(arguments) -> Result:
    session = open_session(arguments)
    return (OK, _render(arguments, session.routes(when(arguments))))


def _stops(arguments) -> Result:
    session = open_session(arguments)
    return (OK, _render(arguments, session.stops(when(arguments))))


def _calendars(arguments) -> Result:
    session = open_session(arguments)
    return (OK, _render(arguments, session.calendars()))


def _summary(arguments) -> Result:
    session = open_session(arguments)
    lines: List[str] = [_render(arguments, session.summary())]
    lines.append("")
    lines.append(_render(arguments, session.service_day(when(arguments))))
    return (OK, "\n".join(lines))


def _save(arguments) -> Result:
    session = open_session(arguments)
    path = session.save(arguments.path)
    return (OK, "Wrote %s (%s)." % (path, session.digest()[:12]))


def _export(arguments) -> Result:
    session = open_session(arguments)
    written = write_feed(session.contents, arguments.directory)
    return (OK, "Wrote %d tables into %s." % (len(written), arguments.directory))


def _demo(arguments) -> Result:
    contents = demo_contents()
    if arguments.write:
        written = write_feed(contents, arguments.write)
        return (OK, "Wrote %d tables into %s." % (len(written), arguments.write))
    session = Session(contents)
    if arguments.summary:
        return (OK, _render(arguments, session.summary()))
    return (OK, str(session))


_HANDLERS = {
    "board": _board,
    "arrivals": _arrivals,
    "plan": _plan,
    "timetable": _timetable,
    "diagram": _diagram,
    "frequency": _frequency,
    "check": _check,
    "routes": _routes,
    "stops": _stops,
    "calendars": _calendars,
    "summary": _summary,
    "save": _save,
    "export": _export,
    "demo": _demo,
}
