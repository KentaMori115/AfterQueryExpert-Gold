"""Matching machinery shared by the query functions."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any

from configlayer.exceptions import ConfigError
from configlayer.policy import KeyPattern


@dataclass(frozen=True)
class Match:
    """One node selected by a query.

    Attributes
    ----------
    path:
        The node's full dotted path within the queried mapping.
    value:
        The node's value — a scalar or list for a leaf, the nested
        mapping itself for an interior node.
    """

    path: str
    value: Any


def compile_patterns(
    patterns: str | KeyPattern | Iterable[str | KeyPattern],
) -> list[KeyPattern]:
    """Normalise the caller's pattern argument into KeyPattern objects.

    Accepts a single pattern (string or :class:`KeyPattern`) or an
    iterable of them.  Pattern syntax and validation are exactly those
    of :class:`configlayer.policy.KeyPattern` — ``*`` matches one
    segment, ``**`` any run of segments, anything else literally.

    Raises
    ------
    ConfigError
        If a pattern is empty, has an empty segment, or embeds ``*``
        inside a literal segment — the same errors KeyPattern raises.
    """
    if isinstance(patterns, (str, KeyPattern)):
        patterns = [patterns]
    compiled: list[KeyPattern] = []
    for pattern in patterns:
        if isinstance(pattern, KeyPattern):
            compiled.append(pattern)
        else:
            compiled.append(KeyPattern(pattern))
    if not compiled:
        raise ConfigError("At least one key pattern is required.")
    return compiled


def matches_any(path: str, patterns: list[KeyPattern]) -> bool:
    """Whether *path* is covered by any of the *patterns*."""
    return any(pattern.matches(path) for pattern in patterns)


def walk_matches(
    config: Mapping[str, Any],
    patterns: list[KeyPattern],
) -> list[Match]:
    """Collect matched nodes in document order, outermost first.

    The mapping is walked depth-first in insertion order.  When a node
    matches, it is reported and its subtree is not descended into, so a
    match that contains another yields only the outermost node.  Only
    string keys are walked; the root itself (the empty path) never
    matches.
    """
    found: list[Match] = []
    _walk(config, "", patterns, found)
    return found


def _walk(
    node: Mapping[str, Any],
    prefix: str,
    patterns: list[KeyPattern],
    found: list[Match],
) -> None:
    for key, value in node.items():
        if not isinstance(key, str):
            continue
        path = f"{prefix}.{key}" if prefix else key
        if matches_any(path, patterns):
            found.append(Match(path, value))
            continue
        if isinstance(value, Mapping):
            _walk(value, path, patterns, found)
