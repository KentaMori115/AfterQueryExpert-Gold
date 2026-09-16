"""The ``functions`` subcommand: list what the engine can call."""

from __future__ import annotations

import argparse

from ...session import Session
from ..formatter import FORMATS, format_rows

__all__ = ["configure", "run"]


def configure(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "pattern",
        nargs="?",
        help="only show functions whose name contains this text",
    )
    parser.add_argument(
        "--kind",
        choices=("all", "scalar", "aggregate"),
        default="all",
        help="restrict the listing to one kind of function",
    )
    parser.add_argument(
        "--format", default="table", choices=FORMATS, help="output format"
    )


def run(session: Session, args: argparse.Namespace) -> int:
    entries = session.registry.entries()
    if args.kind != "all":
        entries = [entry for entry in entries if entry.kind == args.kind]
    if args.pattern:
        needle = args.pattern.lower()
        entries = [entry for entry in entries if needle in entry.name]
    if not entries:
        print("(no matching functions)")
        return 0
    rows = [
        [
            entry.name,
            entry.kind,
            entry.arity,
            ", ".join(entry.aliases),
            entry.description,
        ]
        for entry in entries
    ]
    print(
        format_rows(
            ["name", "kind", "arguments", "aliases", "description"],
            rows,
            args.format,
        )
    )
    return 0
