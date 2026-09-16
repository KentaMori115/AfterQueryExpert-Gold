"""ASCII table rendering shared by the CLI and by ``QueryResult.pretty``."""

from __future__ import annotations

from typing import Any, Optional, Sequence

from .text import truncate

__all__ = ["render_table", "format_cell", "column_widths"]

_NULL_TEXT = "NULL"


def format_cell(value: Any, *, null_text: str = _NULL_TEXT) -> str:
    """Render a single SQL value for display."""

    if value is None:
        return null_text
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float):
        if value != value:  # NaN
            return "NaN"
        if value in (float("inf"), float("-inf")):
            return "Infinity" if value > 0 else "-Infinity"
        text = repr(value)
        return text
    return str(value)


def column_widths(
    headers: Sequence[str],
    rows: Sequence[Sequence[str]],
    *,
    max_width: int,
) -> list[int]:
    """Compute per-column display widths bounded by ``max_width``."""

    widths = [len(header) for header in headers]
    for row in rows:
        for index, cell in enumerate(row):
            if index < len(widths):
                widths[index] = max(widths[index], len(cell))
    return [min(width, max_width) for width in widths]


def render_table(
    headers: Sequence[str],
    rows: Sequence[Sequence[Any]],
    *,
    max_width: int = 40,
    max_rows: Optional[int] = None,
    null_text: str = _NULL_TEXT,
) -> str:
    """Render ``rows`` as a bordered ASCII table.

    A table with no columns renders as ``(no columns)``; a table with columns
    but no rows still renders its header so that the shape of the result stays
    visible.
    """

    if not headers:
        return "(no columns)"

    shown = list(rows) if max_rows is None else list(rows)[:max_rows]
    text_rows = [
        [truncate(format_cell(cell, null_text=null_text), max_width) for cell in row]
        for row in shown
    ]
    widths = column_widths(headers, text_rows, max_width=max_width)

    def _line(left: str, fill: str, mid: str, right: str) -> str:
        return left + mid.join(fill * (width + 2) for width in widths) + right

    def _row(cells: Sequence[str]) -> str:
        padded = [
            cell.ljust(widths[index]) if index < len(widths) else cell
            for index, cell in enumerate(cells)
        ]
        return "| " + " | ".join(padded) + " |"

    out = [
        _line("+", "-", "+", "+"),
        _row([truncate(h, max_width) for h in headers]),
        _line("+", "=", "+", "+"),
    ]
    out.extend(_row(row) for row in text_rows)
    out.append(_line("+", "-", "+", "+"))

    total = len(rows)
    if max_rows is not None and total > len(shown):
        out.append(f"({total - len(shown)} more rows not shown)")
    return "\n".join(out)
