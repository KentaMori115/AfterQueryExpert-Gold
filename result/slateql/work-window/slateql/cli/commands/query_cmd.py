"""The ``query`` subcommand."""

from __future__ import annotations

import argparse
import sys
from typing import Optional

from ...session import Session
from ...util.text import plural
from ...util.timing import Stopwatch, format_duration
from ..formatter import FORMATS, format_result

__all__ = ["configure", "run"]


def configure(parser: argparse.ArgumentParser) -> None:
    """Register the flags this subcommand accepts."""

    parser.add_argument("sql", nargs="?", help="the statement to run")
    parser.add_argument(
        "-f",
        "--file",
        help="read the statement from a file instead of the command line",
    )
    parser.add_argument(
        "--format",
        default="table",
        choices=FORMATS,
        help="output format (default: table)",
    )
    parser.add_argument(
        "--max-rows",
        type=int,
        default=None,
        help="print at most this many rows",
    )
    parser.add_argument(
        "--max-width",
        type=int,
        default=40,
        help="truncate cells wider than this (default: 40)",
    )
    parser.add_argument(
        "--timing",
        action="store_true",
        help="print how long the statement took",
    )
    parser.add_argument(
        "--stats",
        action="store_true",
        help="print execution counters after the result",
    )


def run(session: Session, args: argparse.Namespace) -> int:
    """Execute the statement and print its result."""

    statement = _read_statement(args)
    if statement is None:
        print("error: no statement given", file=sys.stderr)
        return 2

    watch = Stopwatch(start=True)
    result = session.sql(statement)
    watch.stop()

    print(
        format_result(
            result,
            args.format,
            max_rows=args.max_rows,
            max_width=args.max_width,
        )
    )
    if args.format == "table":
        print(f"({plural(len(result), 'row')})")
    if args.timing:
        print(f"time: {format_duration(watch.elapsed)}")
    if args.stats:
        for key in sorted(result.metrics):
            print(f"{key}: {result.metrics[key]}")
    return 0


def _read_statement(args: argparse.Namespace) -> Optional[str]:
    if args.file:
        with open(args.file, "r", encoding="utf-8") as handle:
            return handle.read().strip()
    if args.sql:
        return args.sql.strip()
    if not sys.stdin.isatty():
        text = sys.stdin.read().strip()
        return text or None
    return None
