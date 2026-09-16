"""Sorting and filtering rows of a table, whichever table it is.

Every table in here prints rows that can produce a named cell, so ordering and
filtering can be written once against that. It is deliberately simple: sort by
one or more columns, keep rows whose cell contains a bit of text. Anything more
and the answer is a spreadsheet.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any, Protocol


class Row(Protocol):
    """Anything that can print a named cell."""

    def cell(self, column: str) -> str: ...  # pragma: no cover - a shape, not code


def check_columns(rows: Sequence[Any], columns: Sequence[str]) -> None:
    """Complain about a column no row can print."""
    if not rows:
        return
    unknown = []
    for name in columns:
        try:
            rows[0].cell(name)
        except KeyError:
            unknown.append(name)
    if unknown:
        raise KeyError(f"no such column: {', '.join(unknown)}")


def sort_rows(rows: Sequence[Any], columns: Sequence[str]) -> list[Any]:
    """Sort by the named columns, first one first."""
    if not columns:
        return list(rows)
    check_columns(rows, columns)
    return sorted(rows, key=lambda row: tuple(row.cell(name) for name in columns))


def matching(rows: Sequence[Any], column: str, text: str) -> list[Any]:
    """Rows whose column contains ``text``, ignoring case."""
    check_columns(rows, [column])
    wanted = text.lower()
    return [row for row in rows if wanted in row.cell(column).lower()]


def parse_filter(expression: str) -> tuple[str, str]:
    """Read ``column=text`` into its two halves."""
    if "=" not in expression:
        raise ValueError(f"expected column=text, got {expression!r}")
    column, text = expression.split("=", 1)
    column = column.strip()
    if not column:
        raise ValueError(f"no column in {expression!r}")
    return column, text.strip()


def apply(
    rows: Sequence[Any],
    *,
    sort: Sequence[str] = (),
    filters: Sequence[str] = (),
) -> list[Any]:
    """Filter then sort, which is the order that gives the fewest surprises."""
    found = list(rows)
    for expression in filters:
        column, text = parse_filter(expression)
        found = matching(found, column, text)
    return sort_rows(found, sort)
