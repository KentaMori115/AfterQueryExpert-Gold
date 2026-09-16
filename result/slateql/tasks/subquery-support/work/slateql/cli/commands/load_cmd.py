"""The ``load`` subcommand: convert a data file into another format."""

from __future__ import annotations

import argparse

from ...session import Session
from ..formatter import FORMATS, format_result

__all__ = ["configure", "run"]


def configure(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("table", help="name of a registered table to read")
    parser.add_argument(
        "--format", default="csv", choices=FORMATS, help="output format"
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="stop after this many rows",
    )
    parser.add_argument(
        "--columns",
        default=None,
        help="comma separated list of columns to keep",
    )
    parser.add_argument("-o", "--output", help="write to this file instead of stdout")


def run(session: Session, args: argparse.Namespace) -> int:
    columns = "*"
    if args.columns:
        names = [name.strip() for name in args.columns.split(",") if name.strip()]
        columns = ", ".join(names)
    statement = f"SELECT {columns} FROM {args.table}"
    if args.limit is not None:
        statement += f" LIMIT {args.limit}"
    result = session.sql(statement)
    text = format_result(result, args.format)
    if args.output:
        with open(args.output, "w", encoding="utf-8") as handle:
            handle.write(text + "\n")
        print(f"wrote {len(result)} rows to {args.output}")
    else:
        print(text)
    return 0
