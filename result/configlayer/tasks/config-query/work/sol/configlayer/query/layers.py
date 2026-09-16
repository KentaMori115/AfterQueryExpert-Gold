"""Origin-aware queries over a resolved layer stack."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any

from configlayer.layers import LayeredConfig
from configlayer.policy import KeyPattern
from configlayer.query.match import compile_patterns
from configlayer.query.select import select


@dataclass(frozen=True)
class OriginMatch:
    """One resolved leaf selected by an origin-aware query.

    Attributes
    ----------
    path:
        The leaf's full dotted path in the resolved view.
    value:
        The resolved value the stack produces for that path.
    origin:
        Name of the layer that supplied the value.
    """

    path: str
    value: Any
    origin: str | None


def select_origins(
    config: LayeredConfig,
    patterns: str | KeyPattern | Iterable[str | KeyPattern],
) -> list[OriginMatch]:
    """Query a :class:`LayeredConfig` and report who supplied each leaf.

    The patterns run over the stack's resolved view (``as_dict()``)
    exactly as :func:`configlayer.query.select` would, but every result
    is a *leaf*: a matched interior mapping expands to the leaves inside
    it, in document order, because provenance exists per leaf, not per
    subtree.  Each leaf carries the layer name
    :meth:`~configlayer.layers.LayeredConfig.origin` reports for it.

    Examples
    --------
    A ``**.password`` sweep over a stack answers not just "which
    passwords are set" but "which layer set each one" — the question
    audits actually ask.
    """
    compiled = compile_patterns(patterns)
    resolved = config.as_dict()
    found: list[OriginMatch] = []
    for match in select(resolved, compiled):
        for path, value in _leaves(match.value, match.path):
            found.append(OriginMatch(path, value, config.origin(path)))
    return found


def _leaves(value: Any, path: str) -> list[tuple[str, Any]]:
    """Expand a matched node into its leaves, document order."""
    if not isinstance(value, Mapping):
        return [(path, value)]
    out: list[tuple[str, Any]] = []
    for key, item in value.items():
        if not isinstance(key, str):
            continue
        out.extend(_leaves(item, f"{path}.{key}"))
    return out
