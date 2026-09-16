"""String helpers for identifier handling and human-facing messages."""

from __future__ import annotations

from typing import Iterable, Optional

__all__ = [
    "quote_identifier",
    "unquote_identifier",
    "needs_quoting",
    "indent_block",
    "plural",
    "truncate",
    "edit_distance",
    "suggest",
]

_SAFE_FIRST = set("abcdefghijklmnopqrstuvwxyz_")
_SAFE_REST = _SAFE_FIRST | set("0123456789")


def needs_quoting(name: str) -> bool:
    """Return ``True`` when ``name`` cannot be written bare in SQL text."""

    if not name:
        return True
    if name[0] not in _SAFE_FIRST:
        return True
    return any(ch not in _SAFE_REST for ch in name)


def quote_identifier(name: str) -> str:
    """Return ``name`` quoted with double quotes when necessary."""

    if not needs_quoting(name):
        return name
    escaped = name.replace('"', '""')
    return f'"{escaped}"'


def unquote_identifier(token: str) -> str:
    """Strip surrounding double quotes and unescape doubled quotes."""

    if len(token) >= 2 and token[0] == '"' and token[-1] == '"':
        return token[1:-1].replace('""', '"')
    return token


def indent_block(text: str, prefix: str = "  ") -> str:
    """Prefix every line of ``text`` with ``prefix``."""

    return "\n".join(prefix + line if line else line for line in text.splitlines())


def plural(count: int, singular: str, plural_form: Optional[str] = None) -> str:
    """Return ``"1 row"`` / ``"3 rows"`` style text."""

    word = singular if count == 1 else (plural_form or singular + "s")
    return f"{count} {word}"


def truncate(text: str, width: int, ellipsis: str = "...") -> str:
    """Shorten ``text`` to ``width`` characters, appending ``ellipsis``."""

    if width <= 0:
        return ""
    if len(text) <= width:
        return text
    if width <= len(ellipsis):
        return text[:width]
    return text[: width - len(ellipsis)] + ellipsis


def edit_distance(left: str, right: str) -> int:
    """Return the Levenshtein distance between two strings."""

    if left == right:
        return 0
    if not left:
        return len(right)
    if not right:
        return len(left)
    previous = list(range(len(right) + 1))
    for i, lch in enumerate(left, start=1):
        current = [i]
        for j, rch in enumerate(right, start=1):
            insert = current[j - 1] + 1
            delete = previous[j] + 1
            substitute = previous[j - 1] + (lch != rch)
            current.append(min(insert, delete, substitute))
        previous = current
    return previous[-1]


def suggest(name: str, candidates: Iterable[str], *, limit: int = 3) -> list[str]:
    """Return the closest ``candidates`` to ``name`` for "did you mean" hints.

    Candidates further than a third of the name's length are dropped so that
    wildly unrelated identifiers are never suggested.
    """

    target = name.lower()
    threshold = max(1, len(target) // 3 + 1)
    scored = []
    for candidate in candidates:
        distance = edit_distance(target, candidate.lower())
        if distance <= threshold:
            scored.append((distance, candidate))
    scored.sort(key=lambda pair: (pair[0], pair[1]))
    return [candidate for _, candidate in scored[:limit]]
