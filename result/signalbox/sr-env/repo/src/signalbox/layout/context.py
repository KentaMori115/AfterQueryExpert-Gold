"""Showing the line an error is about, with a mark under it.

``kingsmoor.sbx:14: edge D4 has no length`` tells somebody which line to look
at. Printing the line itself with a caret under it tells them what to look at on
it, which is the difference between fixing the plan and hunting for it.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from ..errors import LayoutError

#: How many lines either side of the offending one to print.
CONTEXT = 1


@dataclass(frozen=True)
class Excerpt:
    """The lines around an error, ready to print."""

    source: str
    line: int
    lines: tuple[tuple[int, str], ...]
    column: int | None = None

    @property
    def is_empty(self) -> bool:
        return not self.lines

    def text(self) -> str:
        if self.is_empty:
            return ""
        width = max(len(str(number)) for number, _ in self.lines)
        out = []
        for number, text in self.lines:
            marker = ">" if number == self.line else " "
            out.append(f"{marker} {str(number).rjust(width)} | {text}")
            if number == self.line and self.column:
                out.append(f"  {' ' * width} | {' ' * (self.column - 1)}^")
        return "\n".join(out) + "\n"

    def __str__(self) -> str:
        return self.text()


def excerpt(
    text: str,
    line: int,
    *,
    source: str = "<string>",
    column: int | None = None,
    context: int = CONTEXT,
) -> Excerpt:
    """The lines around ``line``, numbered from one."""
    all_lines = text.splitlines()
    if line < 1 or line > len(all_lines):
        return Excerpt(source, line, (), column)
    first = max(1, line - context)
    last = min(len(all_lines), line + context)
    chosen = tuple((number, all_lines[number - 1]) for number in range(first, last + 1))
    return Excerpt(source, line, chosen, column)


def excerpt_for(error: LayoutError, text: str | None = None) -> Excerpt | None:
    """The lines an error is about, read from the file it names if need be."""
    if error.line is None or error.source is None:
        return None
    if text is None:
        path = Path(error.source)
        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            return None
    found = excerpt(text, error.line, source=error.source)
    return None if found.is_empty else found


def explain(error: LayoutError, text: str | None = None) -> str:
    """The error, with the line it is about underneath it."""
    found = excerpt_for(error, text)
    if found is None:
        return str(error)
    return f"{error}\n{found.text()}"
