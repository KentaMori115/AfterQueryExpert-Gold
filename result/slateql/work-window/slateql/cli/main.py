"""Command line entry point.

``slateql`` registers data files as tables, then dispatches to a subcommand.
Registration flags are global so that the same ``--csv`` set works for every
subcommand:

.. code-block:: console

    $ slateql --csv orders=orders.csv query "SELECT COUNT(*) FROM orders"
"""

from __future__ import annotations

import argparse
import sys
from typing import Optional, Sequence

from ..config import SessionConfig
from ..errors import SlateQLError
from ..session import Session
from ..version import VERSION
from .commands import (
    bench_cmd,
    explain_cmd,
    functions_cmd,
    load_cmd,
    query_cmd,
    schema_cmd,
)
from .repl import run_repl

__all__ = ["build_parser", "main", "build_session"]

_SUBCOMMANDS = {
    "query": (query_cmd, "run a statement and print the result"),
    "explain": (explain_cmd, "show the plan for a statement"),
    "schema": (schema_cmd, "inspect registered tables"),
    "load": (load_cmd, "export a table in another format"),
    "bench": (bench_cmd, "time a statement over several runs"),
    "functions": (functions_cmd, "list the available functions"),
}


def build_parser() -> argparse.ArgumentParser:
    """Construct the full argument parser, including every subcommand."""

    parser = argparse.ArgumentParser(
        prog="slateql",
        description="Run SQL over CSV and JSONL files.",
    )
    parser.add_argument("--version", action="version", version=f"slateql {VERSION}")
    parser.add_argument(
        "--csv",
        action="append",
        default=[],
        metavar="NAME=PATH",
        help="register a CSV file as a table (repeatable)",
    )
    parser.add_argument(
        "--jsonl",
        action="append",
        default=[],
        metavar="NAME=PATH",
        help="register a JSONL file as a table (repeatable)",
    )
    parser.add_argument(
        "--delimiter",
        default=",",
        help="field delimiter used when reading CSV files (default: ',')",
    )
    parser.add_argument(
        "--no-header",
        action="store_true",
        help="treat the first CSV line as data rather than column names",
    )
    parser.add_argument(
        "--set",
        action="append",
        default=[],
        metavar="OPTION=VALUE",
        help="override a session configuration option (repeatable)",
    )
    parser.add_argument(
        "--shell",
        action="store_true",
        help="start the interactive shell instead of running a subcommand",
    )

    subparsers = parser.add_subparsers(dest="command")
    for name, (module, help_text) in _SUBCOMMANDS.items():
        sub = subparsers.add_parser(name, help=help_text)
        module.configure(sub)
    return parser


def build_session(args: argparse.Namespace) -> Session:
    """Create a session with every requested table registered."""

    overrides = dict(_parse_pair(item, "--set") for item in args.set)
    config = SessionConfig.from_mapping(overrides) if overrides else None
    session = Session(config=config)
    for item in args.csv:
        name, path = _parse_pair(item, "--csv")
        session.register_csv(
            name,
            path,
            delimiter=args.delimiter,
            has_header=not args.no_header,
        )
    for item in args.jsonl:
        name, path = _parse_pair(item, "--jsonl")
        session.register_jsonl(name, path)
    return session


def _parse_pair(item: str, flag: str) -> tuple[str, str]:
    if "=" not in item:
        raise SlateQLError(
            f"{flag} expects NAME=VALUE, got {item!r}",
            hint=f"for example {flag} sales=sales.csv",
        )
    name, _, value = item.partition("=")
    name = name.strip()
    value = value.strip()
    if not name or not value:
        raise SlateQLError(f"{flag} expects a non-empty name and value")
    return name, value


def main(argv: Optional[Sequence[str]] = None) -> int:
    """Parse ``argv`` and dispatch, returning a process exit code."""

    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        session = build_session(args)
    except SlateQLError as error:
        print(f"error: {error}", file=sys.stderr)
        return 2

    if args.shell or args.command is None:
        if args.command is None and not args.shell and not sys.stdin.isatty():
            args.command = "query"
            args.sql = None
            args.file = None
            args.format = "table"
            args.max_rows = None
            args.max_width = 40
            args.timing = False
            args.stats = False
        else:
            return run_repl(session)

    module = _SUBCOMMANDS[args.command][0]
    try:
        return module.run(session, args)
    except SlateQLError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    except BrokenPipeError:  # pragma: no cover - happens under `| head`
        return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
