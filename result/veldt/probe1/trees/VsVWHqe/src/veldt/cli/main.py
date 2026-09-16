"""Command line entry point.

    veldt query --csv trips=trips.csv "SELECT COUNT(*) FROM trips"
    veldt explain --csv trips=trips.csv "SELECT * FROM trips WHERE fare > 10"
    veldt schema --csv trips=trips.csv
    veldt convert trips.csv trips.jsonl

Errors raised by the engine are reported as a single line on stderr with a
non-zero exit code; unexpected exceptions are allowed to propagate so a bug
still produces a traceback.
"""

from __future__ import annotations

import argparse
import sys
from typing import List, Optional, Sequence, TextIO

from ..errors import ParseError, VeldtError
from ..observability.logging import configure_logging, level_from_name
from ..version import VERSION
from .commands import (
    EXIT_ERROR,
    EXIT_OK,
    EXIT_USAGE,
    command_convert,
    command_explain,
    command_query,
    command_schema,
    command_version,
)

__all__ = ["main", "build_parser"]


def _add_table_options(parser: argparse.ArgumentParser) -> None:
    """Add the repeated table binding options shared by most subcommands."""
    parser.add_argument(
        "--csv",
        action="append",
        default=[],
        metavar="NAME=PATH",
        help="register a delimited file as a table (repeatable)",
    )
    parser.add_argument(
        "--jsonl",
        action="append",
        default=[],
        metavar="NAME=PATH",
        help="register a JSON Lines file as a table (repeatable)",
    )
    parser.add_argument(
        "--partitioned",
        action="append",
        default=[],
        metavar="NAME=DIR",
        help="register a hive-style partitioned directory (repeatable)",
    )


def build_parser() -> argparse.ArgumentParser:
    """Build the argument parser for the whole CLI."""
    parser = argparse.ArgumentParser(
        prog="veldt",
        description="Run SQL over local CSV and JSON Lines files.",
    )
    parser.add_argument("--version", action="version", version=f"veldt {VERSION}")
    parser.add_argument(
        "--log-level",
        default="warning",
        metavar="LEVEL",
        help="logging level: debug, info, warning, error (default: warning)",
    )
    subparsers = parser.add_subparsers(dest="command", metavar="COMMAND")

    query = subparsers.add_parser("query", help="run a SQL statement")
    _add_table_options(query)
    query.add_argument("sql", help="the SQL statement to run")
    query.add_argument(
        "--output",
        choices=("table", "csv", "json"),
        default="table",
        help="output format (default: table)",
    )
    query.add_argument(
        "--max-rows",
        type=int,
        default=50,
        help="rows to print before truncating; 0 prints everything",
    )
    query.add_argument(
        "--batch-size", type=int, default=1024, help="rows per internal batch"
    )
    query.add_argument(
        "--no-optimize", action="store_true", help="skip the optimizer"
    )
    query.add_argument(
        "--stats", action="store_true", help="print plan and execution metrics"
    )
    query.set_defaults(handler=command_query)

    explain = subparsers.add_parser("explain", help="print a query plan")
    _add_table_options(explain)
    explain.add_argument("sql", help="the SQL statement to plan")
    explain.add_argument(
        "--logical", action="store_true", help="show the plan before optimization"
    )
    explain.add_argument(
        "--show-schema", action="store_true", help="annotate each node with its schema"
    )
    explain.set_defaults(handler=command_explain)

    schema = subparsers.add_parser("schema", help="print table schemas")
    _add_table_options(schema)
    schema.add_argument(
        "table", nargs="?", help="table to describe; omit to describe them all"
    )
    schema.set_defaults(handler=command_schema)

    convert = subparsers.add_parser("convert", help="convert between file formats")
    convert.add_argument("source", help="file to read")
    convert.add_argument("destination", help="file to write")
    convert.set_defaults(handler=command_convert)

    version = subparsers.add_parser("version", help="print the version")
    version.set_defaults(handler=command_version)
    return parser


def main(
    argv: Optional[Sequence[str]] = None,
    stream: Optional[TextIO] = None,
    error_stream: Optional[TextIO] = None,
) -> int:
    """Run the CLI.

    Args:
        argv: Arguments excluding the program name; defaults to ``sys.argv``.
        stream: Where normal output goes.
        error_stream: Where errors go.

    Returns:
        A process exit code.
    """
    parser = build_parser()
    arguments = parser.parse_args(list(argv) if argv is not None else None)
    errors = error_stream or sys.stderr

    if getattr(arguments, "handler", None) is None:
        parser.print_help(stream or sys.stdout)
        return EXIT_USAGE

    try:
        configure_logging(level_from_name(arguments.log_level))
    except ValueError as error:
        print(f"veldt: {error}", file=errors)
        return EXIT_USAGE

    if getattr(arguments, "max_rows", None) == 0:
        arguments.max_rows = None

    try:
        return arguments.handler(arguments, stream)
    except ParseError as error:
        print(f"veldt: {error.annotated_source()}", file=errors)
        return EXIT_ERROR
    except VeldtError as error:
        print(f"veldt: {error}", file=errors)
        return EXIT_ERROR
    except ValueError as error:
        print(f"veldt: {error}", file=errors)
        return EXIT_USAGE
    except FileNotFoundError as error:
        print(f"veldt: {error.strerror}: {error.filename}", file=errors)
        return EXIT_ERROR


if __name__ == "__main__":  # pragma: no cover - process entry point
    raise SystemExit(main())
