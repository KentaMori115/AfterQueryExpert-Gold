"""The command line grammar: one parser, one subcommand per question.

argparse exits with its own code when the arguments do not parse, which collides
with the code this tool uses for a failure. :func:`parse` catches that and turns
it into a usage exit instead, so a shell script can tell the two apart.
"""

from __future__ import annotations

import argparse
from typing import Optional, Sequence

from layover.cli.exits import USAGE

__all__ = ["UsageError", "build_parser", "parse"]


class UsageError(Exception):
    """The command line could not be read."""

    code = USAGE

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class _Parser(argparse.ArgumentParser):
    """An argument parser that raises rather than calling ``sys.exit``."""

    def error(self, message: str):
        raise UsageError(message)

    def exit(self, status: int = 0, message: Optional[str] = None):
        if status:
            raise UsageError(message or "bad arguments")
        raise SystemExit(status)


def _shared(default: bool) -> argparse.ArgumentParser:
    """The options every command takes, before or after the command word.

    The copy that hangs off a subcommand suppresses its defaults, so writing
    ``--format csv`` after the command overrides the one before it rather than
    the other way round.
    """
    holder = argparse.ArgumentParser(add_help=False)
    nothing = None if default else argparse.SUPPRESS
    holder.add_argument("--feed", default=nothing, help="read a feed directory")
    holder.add_argument("--document", default=nothing, help="read a saved document")
    holder.add_argument("--date", default=nothing, help="the date to ask about, YYYY-MM-DD")
    holder.add_argument(
        "--format",
        default="text" if default else argparse.SUPPRESS,
        choices=("text", "markdown", "csv"),
        help="how to render the answer",
    )
    return holder


def build_parser() -> argparse.ArgumentParser:
    """Build the whole command line grammar."""
    parser = _Parser(
        prog="layover",
        description="Timetables and journey planning.",
        parents=[_shared(True)],
    )
    common = _shared(False)
    commands = parser.add_subparsers(dest="command", metavar="command")

    board = commands.add_parser("board", help="departures from a stop", parents=[common])
    board.add_argument("stop")
    board.add_argument("--after", default="00:00", help="the earliest departure to show")
    board.add_argument("--limit", type=int, default=10)
    board.add_argument("--route", action="append", dest="routes", help="only this route")

    arrivals = commands.add_parser("arrivals", help="arrivals at a stop", parents=[common])
    arrivals.add_argument("stop")
    arrivals.add_argument("--after", default="00:00")
    arrivals.add_argument("--limit", type=int, default=10)

    plan = commands.add_parser("plan", help="journeys from one stop to another", parents=[common])
    plan.add_argument("origin")
    plan.add_argument("destination")
    plan.add_argument("--after", default="08:00")
    plan.add_argument("--window", help="plan a whole window, such as 08:00-10:00")
    plan.add_argument("--changes", type=int, help="how many changes to allow")
    plan.add_argument("--fare", action="store_true", help="price the journey")
    plan.add_argument("--itinerary", action="store_true", help="show every leg")

    arrive = commands.add_parser(
        "arrive", help="journeys that arrive by a deadline", parents=[common]
    )
    arrive.add_argument("origin")
    arrive.add_argument("destination")
    arrive.add_argument("--by", default="09:00", help="the latest acceptable arrival")
    arrive.add_argument("--changes", type=int, help="how many changes to allow")
    arrive.add_argument("--fare", action="store_true", help="price the journey")
    arrive.add_argument("--itinerary", action="store_true", help="show every leg")
    arrive.add_argument(
        "--latest", action="store_true", help="print only the latest departure"
    )

    timetable = commands.add_parser("timetable", help="the printed timetable of a route", parents=[common])
    timetable.add_argument("route", nargs="?")
    timetable.add_argument("--pattern", help="one pattern instead of a whole route")
    timetable.add_argument("--window", help="only trips leaving inside this window")

    diagram = commands.add_parser(
        "diagram", help="draw a route as a line diagram", parents=[common]
    )
    diagram.add_argument("route", nargs="?")
    diagram.add_argument("--pattern", help="one pattern instead of a whole route")

    frequency = commands.add_parser(
        "frequency", help="how often things run", parents=[common]
    )
    frequency.add_argument("stop", nargs="?", help="one stop, sliced through the day")
    frequency.add_argument("--window", default="07:00-09:00", help="the window to count over")
    frequency.add_argument("--routes", action="store_true", help="by route rather than by stop")
    frequency.add_argument("--step", type=int, default=3600, help="slice length in seconds")

    check = commands.add_parser("check", help="run the feed checks", parents=[common])
    check.add_argument("--only", action="append", help="run only this check")
    check.add_argument("--skip", action="append", help="leave this check out")

    commands.add_parser("routes", help="every route", parents=[common])
    commands.add_parser("stops", help="every stop", parents=[common])
    commands.add_parser("calendars", help="every service calendar", parents=[common])
    commands.add_parser("summary", help="what the feed holds", parents=[common])

    save = commands.add_parser("save", help="write the feed out as one document", parents=[common])
    save.add_argument("path")

    export = commands.add_parser("export", help="write the feed out as tables", parents=[common])
    export.add_argument("directory")

    demo = commands.add_parser("demo", help="the worked example network", parents=[common])
    demo.add_argument("--summary", action="store_true", help="print what it holds")
    demo.add_argument("--write", help="write it out as a feed directory")
    return parser


def parse(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    """Read the arguments, raising :class:`UsageError` rather than exiting."""
    parser = build_parser()
    arguments = parser.parse_args(list(argv) if argv is not None else None)
    if not arguments.command:
        raise UsageError("say what to do: %s" % ", ".join(_commands()))
    return arguments


def _commands() -> tuple[str, ...]:
    return (
        "board",
        "arrivals",
        "plan",
        "arrive",
        "timetable",
        "diagram",
        "frequency",
        "check",
        "routes",
        "stops",
        "calendars",
        "summary",
        "save",
        "export",
        "demo",
    )
