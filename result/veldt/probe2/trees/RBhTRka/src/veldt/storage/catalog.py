"""The table catalog.

The catalog maps names to data sources. Lookups are case-insensitive, but the
registered spelling is preserved so plan output shows the name the user chose.
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, Iterator, List, Mapping, Optional, Sequence, Tuple

from ..core.table import Table
from ..errors import TableAlreadyExistsError, TableNotFoundError
from ..types.schema import Schema
from .base import DataSource
from .memory import MemorySource

__all__ = ["Catalog"]


class Catalog:
    """A case-insensitive registry of named data sources."""

    def __init__(self, sources: Mapping[str, DataSource] = ()) -> None:
        self._sources: Dict[str, DataSource] = {}
        self._display_names: Dict[str, str] = {}
        for name, source in dict(sources).items():
            self.register(name, source)

    # ------------------------------------------------------------------
    # Registration
    # ------------------------------------------------------------------
    def register(self, name: str, source: DataSource, replace: bool = False) -> "Catalog":
        """Register a data source under ``name``.

        Raises:
            TableAlreadyExistsError: If the name is taken and ``replace`` is
                false.
            ValueError: If ``name`` is empty.
        """
        if not name or not name.strip():
            raise ValueError("table name must not be empty")
        key = name.lower()
        if key in self._sources and not replace:
            raise TableAlreadyExistsError(name)
        self._sources[key] = source
        self._display_names[key] = name
        return self

    def register_table(self, name: str, table: Table, replace: bool = False) -> "Catalog":
        """Register an in-memory table."""
        return self.register(name, MemorySource(name, table), replace)

    def register_rows(
        self,
        name: str,
        rows: Iterable[Mapping[str, Any]],
        schema: Optional[Schema] = None,
        replace: bool = False,
    ) -> "Catalog":
        """Register dictionaries as an in-memory table."""
        return self.register(name, MemorySource.from_dicts(name, rows, schema), replace)

    def drop(self, name: str, missing_ok: bool = False) -> bool:
        """Remove a registration.

        Args:
            name: The table to remove.
            missing_ok: When true an unknown name is not an error.

        Returns:
            True when something was removed.

        Raises:
            TableNotFoundError: If the name is unknown and ``missing_ok`` is
                false.
        """
        key = name.lower()
        if key not in self._sources:
            if missing_ok:
                return False
            raise TableNotFoundError(name, self.table_names())
        source = self._sources.pop(key)
        self._display_names.pop(key, None)
        source.close()
        return True

    def clear(self) -> None:
        """Remove every registration, closing each source."""
        for source in self._sources.values():
            source.close()
        self._sources.clear()
        self._display_names.clear()

    # ------------------------------------------------------------------
    # Lookup
    # ------------------------------------------------------------------
    def get(self, name: str) -> DataSource:
        """Return the source registered under ``name``.

        Raises:
            TableNotFoundError: If the name is unknown.
        """
        try:
            return self._sources[name.lower()]
        except KeyError:
            raise TableNotFoundError(name, self.table_names()) from None

    def try_get(self, name: str) -> Optional[DataSource]:
        """Return the source, or ``None`` when the name is unknown."""
        return self._sources.get(name.lower())

    def has(self, name: str) -> bool:
        """True when a table with this name is registered."""
        return name.lower() in self._sources

    def schema_of(self, name: str) -> Schema:
        """Return the schema of a registered table."""
        return self.get(name).schema

    def table_names(self) -> List[str]:
        """Registered names in alphabetical order, as originally spelled."""
        return sorted(self._display_names.values(), key=str.lower)

    def items(self) -> List[Tuple[str, DataSource]]:
        """Return ``(name, source)`` pairs sorted by name."""
        return [(name, self.get(name)) for name in self.table_names()]

    def describe(self) -> str:
        """Render a one-line-per-table summary."""
        if not self._sources:
            return "(no tables registered)"
        lines = []
        for name in self.table_names():
            source = self.get(name)
            columns = ", ".join(f"{item.name} {item.dtype}" for item in source.schema)
            lines.append(f"{name}({columns})")
        return "\n".join(lines)

    # ------------------------------------------------------------------
    # Container protocol
    # ------------------------------------------------------------------
    def __len__(self) -> int:
        return len(self._sources)

    def __contains__(self, name: object) -> bool:
        return isinstance(name, str) and self.has(name)

    def __iter__(self) -> Iterator[str]:
        return iter(self.table_names())

    def __getitem__(self, name: str) -> DataSource:
        return self.get(name)

    def __repr__(self) -> str:
        return f"Catalog({len(self._sources)} tables)"

    def copy(self) -> "Catalog":
        """Return a shallow copy sharing the same source objects."""
        clone = Catalog()
        clone._sources = dict(self._sources)
        clone._display_names = dict(self._display_names)
        return clone
