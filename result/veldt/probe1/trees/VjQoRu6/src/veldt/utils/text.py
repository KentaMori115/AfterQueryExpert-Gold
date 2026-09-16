"""String formatting helpers for plan printing and CLI output."""

from __future__ import annotations

from typing import Iterable, List, Optional, Sequence

__all__ = [
    "pad",
    "truncate",
    "indent_lines",
    "quote_identifier",
    "needs_quoting",
    "quote_literal",
    "join_with_and",
    "pluralize",
    "snake_case",
    "display_width",
    "wrap_words",
]

_IDENTIFIER_START = set("abcdefghijklmnopqrstuvwxyz_")
_IDENTIFIER_REST = _IDENTIFIER_START | set("0123456789")


def pad(text: str, width: int, align: str = "left", fill: str = " ") -> str:
    """Pad ``text`` to ``width`` using the requested alignment.

    Text longer than ``width`` is returned unchanged; truncation is a separate
    decision that callers make with :func:`truncate`.

    Raises:
        ValueError: If ``align`` is not ``left``, ``right`` or ``center``.
    """
    if align not in ("left", "right", "center"):
        raise ValueError(f"unknown alignment {align!r}")
    missing = width - display_width(text)
    if missing <= 0:
        return text
    if align == "left":
        return text + fill * missing
    if align == "right":
        return fill * missing + text
    left = missing // 2
    return fill * left + text + fill * (missing - left)


def truncate(text: str, width: int, marker: str = "...") -> str:
    """Shorten ``text`` to ``width`` characters, ending with ``marker``."""
    if width <= 0:
        return ""
    if display_width(text) <= width:
        return text
    if width <= len(marker):
        return text[:width]
    return text[: width - len(marker)] + marker


def indent_lines(text: str, prefix: str = "  ", skip_first: bool = False) -> str:
    """Prefix every line of ``text`` with ``prefix``."""
    lines = text.splitlines()
    out: List[str] = []
    for index, line in enumerate(lines):
        if skip_first and index == 0:
            out.append(line)
        else:
            out.append(prefix + line if line else line)
    return "\n".join(out)


def needs_quoting(name: str) -> bool:
    """True when ``name`` cannot appear bare in generated SQL."""
    if not name:
        return True
    if name[0].lower() not in _IDENTIFIER_START:
        return True
    return any(char.lower() not in _IDENTIFIER_REST for char in name)


def quote_identifier(name: str, force: bool = False) -> str:
    """Return ``name`` wrapped in double quotes when it needs escaping."""
    if force or needs_quoting(name):
        escaped = name.replace('"', '""')
        return f'"{escaped}"'
    return name


def quote_literal(value: str) -> str:
    """Return a single-quoted SQL string literal."""
    return "'" + value.replace("'", "''") + "'"


def join_with_and(items: Sequence[str], conjunction: str = "and") -> str:
    """Join items into readable prose: ``a``, ``a and b``, ``a, b and c``."""
    values = list(items)
    if not values:
        return ""
    if len(values) == 1:
        return values[0]
    if len(values) == 2:
        return f"{values[0]} {conjunction} {values[1]}"
    return ", ".join(values[:-1]) + f" {conjunction} {values[-1]}"


def pluralize(count: int, singular: str, plural: Optional[str] = None) -> str:
    """Return ``"1 row"`` / ``"3 rows"`` style text."""
    word = singular if abs(count) == 1 else (plural or singular + "s")
    return f"{count} {word}"


def snake_case(text: str) -> str:
    """Convert ``CamelCase`` or spaced text into ``snake_case``."""
    out: List[str] = []
    previous_lower = False
    for char in text:
        if char in " -.":
            if out and out[-1] != "_":
                out.append("_")
            previous_lower = False
            continue
        if char.isupper():
            if previous_lower and out and out[-1] != "_":
                out.append("_")
            out.append(char.lower())
            previous_lower = False
        else:
            out.append(char)
            previous_lower = char.islower() or char.isdigit()
    return "".join(out).strip("_")


def display_width(text: str) -> int:
    """Return the printable width of ``text``.

    Tabs count as one column and combining marks count as zero; this is enough
    for the ASCII table renderer without pulling in a unicode width table.
    """
    width = 0
    for char in text:
        if ord(char) in range(0x0300, 0x0370):
            continue
        width += 1
    return width


def wrap_words(text: str, width: int) -> List[str]:
    """Greedily wrap ``text`` into lines no wider than ``width``."""
    if width <= 0:
        return [text]
    lines: List[str] = []
    current = ""
    for word in text.split():
        if not current:
            current = word
        elif len(current) + 1 + len(word) <= width:
            current = f"{current} {word}"
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines or [""]


def bullet_list(items: Iterable[str], marker: str = "-") -> str:
    """Render items as a simple markdown-ish bullet list."""
    return "\n".join(f"{marker} {item}" for item in items)
