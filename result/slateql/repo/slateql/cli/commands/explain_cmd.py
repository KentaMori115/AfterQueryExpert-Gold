"""The ``explain`` subcommand."""

from __future__ import annotations

import argparse
import sys

from ...session import Session

__all__ = ["configure", "run"]


def configure(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("sql", nargs="?", help="the statement to explain")
    parser.add_argument("-f", "--file", help="read the statement from a file")
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="also print the unoptimized and physical plans",
    )
    parser.add_argument(
        "--no-optimize",
        action="store_true",
        help="show the plan exactly as the binder produced it",
    )


def run(session: Session, args: argparse.Namespace) -> int:
    statement = _read(args)
    if statement is None:
        print("error: no statement given", file=sys.stderr)
        return 2
    if args.no_optimize:
        session.configure(optimize=False)
    print(session.explain(statement, verbose=args.verbose))
    return 0


def _read(args: argparse.Namespace) -> str | None:
    if args.file:
        with open(args.file, "r", encoding="utf-8") as handle:
            return handle.read().strip()
    if args.sql:
        return args.sql.strip()
    if not sys.stdin.isatty():
        return sys.stdin.read().strip() or None
    return None
