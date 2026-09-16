"""A compiled, reusable query."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

from configlayer.policy import KeyPattern
from configlayer.query.match import Match, compile_patterns
from configlayer.query.select import select as _select
from configlayer.query.transform import pick as _pick
from configlayer.query.transform import prune as _prune


class Query:
    """A pattern set compiled once and applied many times.

    The module-level functions re-validate their patterns on every
    call; code that runs the same sweep over many configs — every
    request, every reload — can compile a :class:`Query` up front and
    reuse it.  The operations mirror the module functions exactly.

    Examples
    --------
    >>> secrets = Query(["**.password", "**.token"])
    >>> secrets.paths({"db": {"password": "x"}})
    ['db.password']
    """

    def __init__(
        self,
        patterns: str | KeyPattern | Iterable[str | KeyPattern],
    ) -> None:
        self._patterns = compile_patterns(patterns)

    @property
    def patterns(self) -> list[KeyPattern]:
        """The compiled :class:`KeyPattern` objects, in caller order."""
        return list(self._patterns)

    # ------------------------------------------------------------------
    # Read operations
    # ------------------------------------------------------------------

    def select(self, config: Mapping[str, Any]) -> list[Match]:
        """Matched nodes of *config*, exactly as the module-level
        :func:`configlayer.query.select` reports them.

        Every read operation routes through here, so a compiled query
        accepts and rejects exactly what the module-level functions do:
        a *config* that is not a mapping raises
        :class:`~configlayer.exceptions.ConfigError`.
        """
        return _select(config, self._patterns)

    def first(self, config: Mapping[str, Any], default: Any = None) -> Any:
        """Value of the first match in document order, or *default*."""
        found = self.select(config)
        return found[0].value if found else default

    def paths(self, config: Mapping[str, Any]) -> list[str]:
        """Just the dotted paths of the matches."""
        return [match.path for match in self.select(config)]

    def values(self, config: Mapping[str, Any]) -> list[Any]:
        """Just the values of the matches."""
        return [match.value for match in self.select(config)]

    def matches(self, config: Mapping[str, Any]) -> bool:
        """Whether the query selects anything at all in *config*."""
        return bool(self.select(config))

    # ------------------------------------------------------------------
    # Transforms
    # ------------------------------------------------------------------

    def pick(self, config: Mapping[str, Any]) -> dict[str, Any]:
        """Shape-preserving copy holding only the matched nodes."""
        return _pick(config, self._patterns)

    def prune(self, config: Mapping[str, Any]) -> dict[str, Any]:
        """Shape-preserving copy with the matched nodes removed."""
        return _prune(config, self._patterns)

    def __repr__(self) -> str:
        inner = ", ".join(p.pattern for p in self._patterns)
        return f"Query([{inner}])"
