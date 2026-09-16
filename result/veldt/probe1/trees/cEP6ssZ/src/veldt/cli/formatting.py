"""Terminal rendering of tables and schemas.

The renderer measures every cell it is going to print, so column widths are
exact rather than guessed. Long values are truncated with an ellipsis and wide
tables are left to the terminal to wrap; nothing here tries to be clever about
the window size.
"""

from __future__ import annotations

from typing import List, Optional, Sequence

from ..core.table import Table
from ..types.dtypes import DataType
from ..types.schema import Schema
from ..types.value import format_value
from ..utils.text import display_width, pad, pluralize, truncate

__all__ = ["render_table", "render_schema", "render_rows", "DEFAULT_MAX_WIDTH"]

DEFAULT_MAX_WIDTH = 40
NULL_TEXT = "NULL"

# Numeric columns read better right aligned; everything else left aligned.
_RIGHT_ALIGNED = frozenset({DataType.INT64, DataType.FLOAT64})


def render_table(
    table: Table,
    max_rows: Optional[int] = 50,
    max_width: int = DEFAULT_MAX_WIDTH,
    show_footer: bool = True,
) -> str:
    """Render a table as an ASCII grid.

    Args:
        table: The table to render.
        max_rows: Stop after this many rows, noting how many were hidden.
            ``None`` prints every row.
        max_width: Truncate any cell wider than this.
        show_footer: Append a row count line.
    """
    if not len(table.schema):
        return "(no columns)"
    limited = table if max_rows is None else table.head(max_rows)
    headers = table.column_names
    body: List[List[str]] = []
    for row in limited.tuples():
        body.append([truncate(_cell(value), max_width) for value in row])

    widths = [display_width(name) for name in headers]
    for line in body:
        for index, cell in enumerate(line):
            widths[index] = max(widths[index], display_width(cell))

    alignments = [
        "right" if field.dtype in _RIGHT_ALIGNED else "left" for field in table.schema
    ]
    separator = "+" + "+".join("-" * (width + 2) for width in widths) + "+"
    lines = [separator, _row(headers, widths, ["left"] * len(widths)), separator]
    lines.extend(_row(line, widths, alignments) for line in body)
    lines.append(separator)
    if show_footer:
        lines.append(_footer(table, limited))
    return "\n".join(lines)


def render_rows(
    rows: Sequence[Sequence[object]], headers: Sequence[str], max_width: int = DEFAULT_MAX_WIDTH
) -> str:
    """Render raw rows without a schema, for ad-hoc listings."""
    body = [[truncate(_cell(value), max_width) for value in row] for row in rows]
    widths = [display_width(name) for name in headers]
    for line in body:
        for index, cell in enumerate(line):
            widths[index] = max(widths[index], display_width(cell))
    separator = "+" + "+".join("-" * (width + 2) for width in widths) + "+"
    lines = [separator, _row(headers, widths, ["left"] * len(widths)), separator]
    lines.extend(_row(line, widths, ["left"] * len(widths)) for line in body)
    lines.append(separator)
    return "\n".join(lines)


def render_schema(schema: Schema, name: Optional[str] = None) -> str:
    """Render a schema as a two-column listing."""
    if not len(schema):
        return f"{name or 'table'} has no columns"
    rows = [
        [field.name, str(field.dtype), "" if field.nullable else "NOT NULL"]
        for field in schema
    ]
    heading = f"{name}\n" if name else ""
    return heading + render_rows(rows, ["column", "type", "flags"])


def _row(cells: Sequence[str], widths: Sequence[int], alignments: Sequence[str]) -> str:
    """Render one grid row with padding and separators."""
    parts = [
        " " + pad(str(cell), width, align) + " "
        for cell, width, align in zip(cells, widths, alignments)
    ]
    return "|" + "|".join(parts) + "|"


def _cell(value: object) -> str:
    """Render one value for display."""
    return format_value(value, NULL_TEXT)


def _footer(table: Table, shown: Table) -> str:
    """Render the row count, noting truncation when it happened."""
    total = table.num_rows
    if shown.num_rows < total:
        hidden = total - shown.num_rows
        return f"({pluralize(total, 'row')}, {hidden} not shown)"
    return f"({pluralize(total, 'row')})"
