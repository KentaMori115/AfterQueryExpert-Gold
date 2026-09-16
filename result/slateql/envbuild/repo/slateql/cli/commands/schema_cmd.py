"""The ``schema`` subcommand: inspect registered tables."""

from __future__ import annotations

import argparse

from ...session import Session
from ..formatter import FORMATS, format_rows

__all__ = ["configure", "run"]


def configure(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "table",
        nargs="?",
        help="show one table's columns; omit to list every table",
    )
    parser.add_argument(
        "--format", default="table", choices=FORMATS, help="output format"
    )
    parser.add_argument(
        "--analyze",
        action="store_true",
        help="scan each table and report row counts and column statistics",
    )


def run(session: Session, args: argparse.Namespace) -> int:
    if args.table:
        return _one_table(session, args)
    rows = [
        [name, str(len(session.schema_of(name)))] for name in session.tables()
    ]
    if not rows:
        print("(no tables registered)")
        return 0
    print(format_rows(["table", "columns"], rows, args.format))
    if args.analyze:
        print()
        for name in session.tables():
            print(f"{name}:")
            print(session.catalog.get(name).analyze().describe())
    return 0


def _one_table(session: Session, args: argparse.Namespace) -> int:
    schema = session.schema_of(args.table)
    rows = [
        [field.name, field.dtype.name, "yes" if field.dtype.nullable else "no"]
        for field in schema
    ]
    print(format_rows(["column", "type", "nullable"], rows, args.format))
    if args.analyze:
        print()
        print(session.catalog.get(args.table).analyze().describe())
    return 0
