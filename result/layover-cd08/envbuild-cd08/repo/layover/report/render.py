"""Turning a table of strings into text, markdown or comma separated output.

Three renderings of the same rows, because the same board is wanted on a
terminal, in a document and in a spreadsheet. Nothing here knows what a stop or
a trip is: a report is a title, a header row, some rows and some notes.
"""

from __future__ import annotations

import csv
import io
from dataclasses import dataclass, field
from enum import Enum
from typing import Iterable, Sequence, Tuple

from layover.errors import LayoverError

__all__ = ["Rendering", "Report", "align_columns", "text_table"]


class Rendering(Enum):
    """How a report is written out."""

    TEXT = "text"
    MARKDOWN = "markdown"
    CSV = "csv"

    @classmethod
    def parse(cls, text) -> "Rendering":
        """Read a rendering from its name."""
        if isinstance(text, Rendering):
            return text
        cleaned = str(text).strip().lower()
        for rendering in cls:
            if rendering.value == cleaned:
                return rendering
        raise LayoverError("no such rendering: %r" % (text,))

    def __str__(self) -> str:
        return self.value


def align_columns(rows: Sequence[Sequence[str]]) -> tuple[int, ...]:
    """The width each column needs, in characters."""
    widths: list = []
    for row in rows:
        for index, cell in enumerate(row):
            if index >= len(widths):
                widths.append(0)
            widths[index] = max(widths[index], len(str(cell)))
    return tuple(widths)


def text_table(
    headers: Sequence[str],
    rows: Sequence[Sequence[str]],
    right: Iterable[int] = (),
) -> tuple[str, ...]:
    """Lay a table out in fixed width columns, with a rule under the header."""
    right_aligned = set(right)
    widths = align_columns([headers, *rows])
    lines = []
    lines.append(_line(headers, widths, right_aligned))
    lines.append("-" * len(lines[0]))
    for row in rows:
        lines.append(_line(row, widths, right_aligned))
    return tuple(line.rstrip() for line in lines)


def _line(row: Sequence[str], widths: Sequence[int], right: set) -> str:
    cells = []
    for index, width in enumerate(widths):
        cell = str(row[index]) if index < len(row) else ""
        cells.append(cell.rjust(width) if index in right else cell.ljust(width))
    return "  ".join(cells)


@dataclass(frozen=True)
class Report:
    """A title, a header row, some rows, and any notes underneath."""

    title: str
    headers: Tuple[str, ...]
    rows: Tuple[Tuple[str, ...], ...] = ()
    notes: Tuple[str, ...] = ()
    right: Tuple[int, ...] = ()

    def __post_init__(self) -> None:
        object.__setattr__(self, "headers", tuple(str(header) for header in self.headers))
        object.__setattr__(
            self, "rows", tuple(tuple(str(cell) for cell in row) for row in self.rows)
        )
        object.__setattr__(self, "notes", tuple(str(note) for note in self.notes))
        object.__setattr__(self, "right", tuple(int(index) for index in self.right))
        for row in self.rows:
            if len(row) != len(self.headers):
                raise LayoverError(
                    "a report row has %d cells and the header has %d"
                    % (len(row), len(self.headers))
                )

    def __len__(self) -> int:
        return len(self.rows)

    @property
    def is_empty(self) -> bool:
        """Whether the report has no rows at all."""
        return not self.rows

    def as_text(self) -> str:
        """The report as fixed width text, title first."""
        lines = [self.title] if self.title else []
        lines.extend(text_table(self.headers, self.rows, self.right))
        if self.notes:
            lines.append("")
            lines.extend(self.notes)
        return "\n".join(lines)

    def as_markdown(self) -> str:
        """The report as a markdown table under a heading."""
        lines = []
        if self.title:
            lines.append("## %s" % self.title)
            lines.append("")
        lines.append("| %s |" % " | ".join(self.headers))
        lines.append("| %s |" % " | ".join("---" for _ in self.headers))
        for row in self.rows:
            lines.append("| %s |" % " | ".join(_escaped(cell) for cell in row))
        if self.notes:
            lines.append("")
            for note in self.notes:
                lines.append("- %s" % note)
        return "\n".join(lines)

    def as_csv(self) -> str:
        """The report as comma separated rows, the header first and no title."""
        output = io.StringIO()
        writer = csv.writer(output, lineterminator="\n")
        writer.writerow(self.headers)
        for row in self.rows:
            writer.writerow(row)
        return output.getvalue()

    def render(self, style=Rendering.TEXT) -> str:
        """The report in whichever of the three renderings is asked for."""
        rendering = Rendering.parse(style)
        if rendering is Rendering.TEXT:
            return self.as_text()
        if rendering is Rendering.MARKDOWN:
            return self.as_markdown()
        return self.as_csv()

    def with_notes(self, notes: Iterable[str]) -> "Report":
        """Return the same report with more said underneath it."""
        return Report(self.title, self.headers, self.rows, self.notes + tuple(notes), self.right)

    def __str__(self) -> str:
        return "%s (%d rows)" % (self.title or "report", len(self.rows))


def _escaped(cell: str) -> str:
    return str(cell).replace("|", "\\|")
