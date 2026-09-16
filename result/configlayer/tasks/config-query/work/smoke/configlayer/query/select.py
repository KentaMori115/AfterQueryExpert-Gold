"""Read-only queries: select, first, paths, values."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

from configlayer.exceptions import ConfigError
from configlayer.policy import KeyPattern
from configlayer.query.match import Match, compile_patterns, walk_matches

_MISSING = object()

Patterns = "str | KeyPattern | Iterable[str | KeyPattern]"


def select(
    config: Mapping[str, Any],
    patterns: str | KeyPattern | Iterable[str | KeyPattern],
) -> list[Match]:
    """Return every node of *config* the *patterns* cover.

    Nodes come back as :class:`Match` records in document order —
    depth-first, following the mapping's own key order.  A matched
    interior mapping is reported once as a whole; nothing inside an
    already-matched node is reported again.

    Parameters
    ----------
    config:
        The nested mapping to query.
    patterns:
        One pattern or an iterable of patterns; ``db.*`` covers
        ``db.host`` but not ``db.pool.size``, ``db.**`` covers both,
        ``**.password`` covers a password leaf at any depth.

    Raises
    ------
    ConfigError
        If *config* is not a mapping or a pattern is invalid.

    Examples
    --------
    >>> select({"db": {"host": "h", "port": 1}}, "db.*")
    [Match(path='db.host', value='h'), Match(path='db.port', value=1)]
    """
    if not isinstance(config, Mapping):
        raise ConfigError(
            f"select needs a mapping, got {type(config).__name__}"
        )
    return walk_matches(config, compile_patterns(patterns))


def first(
    config: Mapping[str, Any],
    patterns: str | KeyPattern | Iterable[str | KeyPattern],
    default: Any = None,
) -> Any:
    """Return the value of the first node the *patterns* cover.

    "First" is document order, exactly as :func:`select` reports it.
    When nothing matches, *default* is returned.
    """
    found = select(config, patterns)
    if not found:
        return default
    return found[0].value


def paths(
    config: Mapping[str, Any],
    patterns: str | KeyPattern | Iterable[str | KeyPattern],
) -> list[str]:
    """Return just the dotted paths :func:`select` would report."""
    return [match.path for match in select(config, patterns)]


def values(
    config: Mapping[str, Any],
    patterns: str | KeyPattern | Iterable[str | KeyPattern],
) -> list[Any]:
    """Return just the values :func:`select` would report."""
    return [match.value for match in select(config, patterns)]
