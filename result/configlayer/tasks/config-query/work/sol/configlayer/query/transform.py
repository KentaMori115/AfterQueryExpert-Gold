"""Shape-preserving transforms: pick and prune."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

from configlayer.exceptions import ConfigError
from configlayer.policy import KeyPattern
from configlayer.query.match import compile_patterns, matches_any


def pick(
    config: Mapping[str, Any],
    patterns: str | KeyPattern | Iterable[str | KeyPattern],
) -> dict[str, Any]:
    """Return a copy of *config* containing only the matched nodes.

    The original nesting and key order are preserved; a matched
    interior mapping brings its whole subtree along.  Parent mappings
    appear only when something beneath them was picked, so picking
    nothing returns ``{}``.  The input is never mutated, and matched
    mappings are copied, not shared.

    Examples
    --------
    >>> pick({"db": {"host": "h", "password": "x"}}, "**.password")
    {'db': {'password': 'x'}}
    """
    if not isinstance(config, Mapping):
        raise ConfigError(
            f"pick needs a mapping, got {type(config).__name__}"
        )
    compiled = compile_patterns(patterns)
    return _pick(config, "", compiled)


def _pick(
    node: Mapping[str, Any],
    prefix: str,
    patterns: list[KeyPattern],
) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in node.items():
        if not isinstance(key, str):
            continue
        path = f"{prefix}.{key}" if prefix else key
        if matches_any(path, patterns):
            out[key] = _copy(value)
        elif isinstance(value, Mapping):
            kept = _pick(value, path, patterns)
            if kept:
                out[key] = kept
    return out


def prune(
    config: Mapping[str, Any],
    patterns: str | KeyPattern | Iterable[str | KeyPattern],
) -> dict[str, Any]:
    """Return a copy of *config* with the matched nodes removed.

    The exact complement of :func:`pick` under the same patterns: a
    matched interior mapping disappears with its whole subtree, and a
    mapping whose every entry was pruned stays behind as an empty
    mapping, so the surviving shape is predictable.  The input is never
    mutated.

    Examples
    --------
    >>> prune({"db": {"host": "h", "password": "x"}}, "**.password")
    {'db': {'host': 'h'}}
    """
    if not isinstance(config, Mapping):
        raise ConfigError(
            f"prune needs a mapping, got {type(config).__name__}"
        )
    compiled = compile_patterns(patterns)
    return _prune(config, "", compiled)


def _prune(
    node: Mapping[str, Any],
    prefix: str,
    patterns: list[KeyPattern],
) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in node.items():
        if not isinstance(key, str):
            continue
        path = f"{prefix}.{key}" if prefix else key
        if matches_any(path, patterns):
            continue
        if isinstance(value, Mapping):
            out[key] = _prune(value, path, patterns)
        else:
            out[key] = _copy(value)
    return out


def _copy(value: Any) -> Any:
    """Deep-copy mappings and lists so the result never aliases input."""
    if isinstance(value, Mapping):
        return {key: _copy(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_copy(item) for item in value]
    return value
