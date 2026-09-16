"""Turning a control table into something that can be read or diffed.

Three formats, for three audiences. Plain text is for looking at, CSV is for the
people who will open it in a spreadsheet whatever anyone says, and markdown is
for pasting into the design record. All three take the same column selection so
that a narrow terminal and a wide sign off document can show the same table.
"""

from __future__ import annotations

import csv
import io
from collections.abc import Callable, Iterable, Sequence
from typing import Any

from .control_table import COLUMNS, ControlRow, ControlTable

#: A sensible subset for a terminal that is not very wide.
NARROW = ("route", "from", "to", "points normal", "points reverse", "track clear")


def _rows_of(table: ControlTable | Iterable[ControlRow]) -> list[ControlRow]:
    return list(table)


def _check_columns(columns: Sequence[str], rows: Sequence[Any]) -> tuple[str, ...]:
    """Check the columns against the rows themselves rather than a fixed list.

    The same renderers print the control table, the points table and the locking
    table, and each of those has its own columns. Asking a row whether it can
    print a column is the only check that works for all three.
    """
    if not rows:
        return tuple(columns)
    unknown = []
    for name in columns:
        try:
            rows[0].cell(name)
        except KeyError:
            unknown.append(name)
    if unknown:
        raise KeyError(f"no such column: {', '.join(unknown)}")
    return tuple(columns)


def column_widths(rows: Sequence[ControlRow], columns: Sequence[str]) -> list[int]:
    """How wide each column has to be to hold its heading and its contents."""
    widths = [len(name) for name in columns]
    for row in rows:
        for index, name in enumerate(columns):
            widths[index] = max(widths[index], len(row.cell(name)))
    return widths


def render_text(
    table: ControlTable | Iterable[ControlRow],
    columns: Sequence[str] = COLUMNS,
    *,
    separator: str = "  ",
) -> str:
    """A fixed width grid with a rule under the headings."""
    rows = _rows_of(table)
    columns = _check_columns(columns, rows)
    widths = column_widths(rows, columns)

    lines = [
        separator.join(name.ljust(width) for name, width in zip(columns, widths, strict=True))
    ]
    lines.append(separator.join("-" * width for width in widths))
    lines.extend(
        separator.join(
            row.cell(name).ljust(width) for name, width in zip(columns, widths, strict=True)
        ).rstrip()
        for row in rows
    )
    return "\n".join(line.rstrip() for line in lines) + "\n"


def render_csv(
    table: ControlTable | Iterable[ControlRow], columns: Sequence[str] = COLUMNS
) -> str:
    """Comma separated, with the column names as the first line."""
    rows = _rows_of(table)
    columns = _check_columns(columns, rows)
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(columns)
    for row in rows:
        writer.writerow([row.cell(name) for name in columns])
    return buffer.getvalue()


def render_markdown(
    table: ControlTable | Iterable[ControlRow], columns: Sequence[str] = COLUMNS
) -> str:
    """A pipe table, with empty cells written as a dash so they are visible."""
    rows = _rows_of(table)
    columns = _check_columns(columns, rows)

    lines = ["| " + " | ".join(columns) + " |"]
    lines.append("| " + " | ".join("---" for _ in columns) + " |")
    for row in rows:
        cells = [row.cell(name).replace("|", "\\|") or "-" for name in columns]
        lines.append("| " + " | ".join(cells) + " |")
    return "\n".join(lines) + "\n"


Renderer = Callable[[Any, Sequence[str]], str]

RENDERERS: dict[str, Renderer] = {
    "text": render_text,
    "csv": render_csv,
    "markdown": render_markdown,
}


def render(
    table: ControlTable | Iterable[ControlRow],
    fmt: str = "text",
    columns: Sequence[str] = COLUMNS,
) -> str:
    """Render in whichever format was asked for by name."""
    try:
        renderer = RENDERERS[fmt]
    except KeyError:
        raise KeyError(
            f"no such format: {fmt}, try one of {', '.join(sorted(RENDERERS))}"
        ) from None
    return renderer(table, columns)
