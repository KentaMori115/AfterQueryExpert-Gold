"""The function registry.

A registry maps lower-cased names to scalar or aggregate definitions.  Sessions
share the process-wide default registry unless they are given their own, which
lets tests register throwaway functions without leaking them.
"""

from __future__ import annotations

from typing import Iterable, Iterator, Optional

from ..errors import UnknownFunctionError
from ..util.text import suggest
from .signature import (
    AggregateFunctionDef,
    FunctionCatalogEntry,
    ScalarFunctionDef,
)

__all__ = ["FunctionRegistry", "default_registry", "builtin_registry"]


class FunctionRegistry:
    """Name -> definition lookup for scalar and aggregate functions."""

    def __init__(self, *, parent: Optional["FunctionRegistry"] = None) -> None:
        self._scalars: dict[str, ScalarFunctionDef] = {}
        self._aggregates: dict[str, AggregateFunctionDef] = {}
        self._aliases: dict[str, str] = {}
        self._parent = parent

    # -- registration ----------------------------------------------------

    def register_scalar(
        self, definition: ScalarFunctionDef, *aliases: str
    ) -> ScalarFunctionDef:
        key = definition.name.lower()
        self._scalars[key] = definition
        for alias in aliases:
            self._aliases[alias.lower()] = key
        return definition

    def register_aggregate(
        self, definition: AggregateFunctionDef, *aliases: str
    ) -> AggregateFunctionDef:
        key = definition.name.lower()
        self._aggregates[key] = definition
        for alias in aliases:
            self._aliases[alias.lower()] = key
        return definition

    def unregister(self, name: str) -> None:
        key = self._canonical(name)
        self._scalars.pop(key, None)
        self._aggregates.pop(key, None)

    # -- lookup ----------------------------------------------------------

    def _canonical(self, name: str) -> str:
        key = name.lower()
        return self._aliases.get(key, key)

    def has(self, name: str) -> bool:
        key = self._canonical(name)
        if key in self._scalars or key in self._aggregates:
            return True
        return self._parent.has(key) if self._parent else False

    def is_aggregate(self, name: str) -> bool:
        key = self._canonical(name)
        if key in self._aggregates:
            return True
        if key in self._scalars:
            return False
        return self._parent.is_aggregate(key) if self._parent else False

    def scalar(self, name: str) -> ScalarFunctionDef:
        key = self._canonical(name)
        found = self._scalars.get(key)
        if found is not None:
            return found
        if self._parent is not None and self._parent.has(key):
            return self._parent.scalar(key)
        if self.is_aggregate(key):
            raise UnknownFunctionError(
                f"{name}() is an aggregate function and cannot be used here",
                hint="aggregates are only valid in SELECT, HAVING and ORDER BY",
            )
        raise self._unknown(name)

    def aggregate(self, name: str) -> AggregateFunctionDef:
        key = self._canonical(name)
        found = self._aggregates.get(key)
        if found is not None:
            return found
        if self._parent is not None and self._parent.has(key):
            return self._parent.aggregate(key)
        raise self._unknown(name)

    def _unknown(self, name: str) -> UnknownFunctionError:
        hints = suggest(name, self.names())
        return UnknownFunctionError(
            f"unknown function: {name}()",
            hint=("did you mean " + ", ".join(f"{h}()" for h in hints) + "?")
            if hints
            else None,
        )

    # -- introspection ---------------------------------------------------

    def names(self) -> list[str]:
        out = set(self._scalars) | set(self._aggregates) | set(self._aliases)
        if self._parent is not None:
            out |= set(self._parent.names())
        return sorted(out)

    def scalar_names(self) -> list[str]:
        out = set(self._scalars)
        if self._parent is not None:
            out |= set(self._parent.scalar_names())
        return sorted(out)

    def aggregate_names(self) -> list[str]:
        out = set(self._aggregates)
        if self._parent is not None:
            out |= set(self._parent.aggregate_names())
        return sorted(out)

    def entries(self) -> list[FunctionCatalogEntry]:
        """Describe every registered function, for ``slateql functions``."""

        aliases_by_target: dict[str, list[str]] = {}
        for alias, target in self._aliases.items():
            aliases_by_target.setdefault(target, []).append(alias)
        out: list[FunctionCatalogEntry] = []
        for name, definition in sorted(self._scalars.items()):
            out.append(
                FunctionCatalogEntry(
                    name=name,
                    kind="scalar",
                    arity=definition.arity.describe(),
                    description=definition.description,
                    aliases=tuple(sorted(aliases_by_target.get(name, ()))),
                )
            )
        for name, agg in sorted(self._aggregates.items()):
            out.append(
                FunctionCatalogEntry(
                    name=name,
                    kind="aggregate",
                    arity=agg.arity.describe(),
                    description=agg.description,
                    aliases=tuple(sorted(aliases_by_target.get(name, ()))),
                )
            )
        return out

    def __iter__(self) -> Iterator[str]:
        return iter(self.names())

    def __len__(self) -> int:
        return len(self.names())

    def extend(self, definitions: Iterable[object]) -> None:
        """Bulk-register a mixture of scalar and aggregate definitions."""

        for definition in definitions:
            if isinstance(definition, ScalarFunctionDef):
                self.register_scalar(definition)
            elif isinstance(definition, AggregateFunctionDef):
                self.register_aggregate(definition)
            else:  # pragma: no cover - defensive
                raise TypeError(
                    f"cannot register {type(definition).__name__} in a registry"
                )


_DEFAULT: Optional[FunctionRegistry] = None


def builtin_registry() -> FunctionRegistry:
    """Construct a fresh registry populated with every built-in function."""

    from . import (
        aggregate_defs,
        scalar_cast,
        scalar_conditional,
        scalar_datetime,
        scalar_math,
        scalar_string,
    )

    registry = FunctionRegistry()
    for module in (
        scalar_string,
        scalar_math,
        scalar_datetime,
        scalar_conditional,
        scalar_cast,
        aggregate_defs,
    ):
        module.register(registry)
    return registry


def default_registry() -> FunctionRegistry:
    """Return the shared process-wide registry, building it on first use."""

    global _DEFAULT
    if _DEFAULT is None:
        _DEFAULT = builtin_registry()
    return _DEFAULT
