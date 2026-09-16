"""The table catalog.

The catalog owns name resolution.  Names are case-insensitive by default,
matching the lexer's identifier folding, but a catalog can be built in
case-sensitive mode for callers that register mixed-case names deliberately.
"""

from __future__ import annotations

from typing import Any, Iterable, Iterator, Mapping, Optional, Sequence

from ..errors import UnknownTableError
from ..types.schema import Schema
from ..util.text import suggest
from .sources.base import DataSource
from .sources.memory import MemorySource
from .table import Table

__all__ = ["Catalog"]


class Catalog:
    """Maps table names to :class:`~slateql.storage.table.Table` objects."""

    def __init__(self, *, case_sensitive: bool = False) -> None:
        self._tables: dict[str, Table] = {}
        self._display_names: dict[str, str] = {}
        self._case_sensitive = case_sensitive

    def _key(self, name: str) -> str:
        return name if self._case_sensitive else name.lower()

    # -- registration ----------------------------------------------------

    def register(self, name: str, source: DataSource) -> Table:
        """Register ``source`` under ``name``, replacing any existing table."""

        table = Table(name=name, source=source)
        key = self._key(name)
        self._tables[key] = table
        self._display_names[key] = name
        return table

    def register_rows(
        self,
        name: str,
        schema: Schema,
        rows: Iterable[Sequence[Any]],
    ) -> Table:
        """Convenience wrapper registering an in-memory table."""

        return self.register(name, MemorySource(schema, rows, label=name))

    def register_dicts(
        self,
        name: str,
        records: Iterable[Mapping[str, Any]],
        *,
        schema: Optional[Schema] = None,
    ) -> Table:
        """Register an in-memory table built from dictionaries."""

        return self.register(
            name, MemorySource.from_dicts(records, schema=schema, label=name)
        )

    def drop(self, name: str) -> bool:
        """Remove a table, returning whether anything was removed."""

        key = self._key(name)
        self._display_names.pop(key, None)
        return self._tables.pop(key, None) is not None

    def clear(self) -> None:
        self._tables.clear()
        self._display_names.clear()

    # -- lookup ----------------------------------------------------------

    def has(self, name: str) -> bool:
        return self._key(name) in self._tables

    def get(self, name: str) -> Table:
        """Resolve ``name`` or raise :class:`UnknownTableError`."""

        table = self._tables.get(self._key(name))
        if table is None:
            hints = suggest(name, self.table_names())
            raise UnknownTableError(
                f"no such table: {name}",
                hint=("did you mean " + ", ".join(hints) + "?") if hints else None,
            )
        return table

    def try_get(self, name: str) -> Optional[Table]:
        return self._tables.get(self._key(name))

    def schema_of(self, name: str) -> Schema:
        return self.get(name).schema

    def table_names(self) -> list[str]:
        """Registered names in their original casing, sorted."""

        return sorted(self._display_names.values())

    def tables(self) -> list[Table]:
        return [self._tables[key] for key in sorted(self._tables)]

    # -- maintenance -----------------------------------------------------

    def analyze(self, name: Optional[str] = None) -> dict[str, int]:
        """Recompute statistics for one table or for every table."""

        targets = [self.get(name)] if name else self.tables()
        return {table.name: table.analyze().row_count for table in targets}

    def __contains__(self, name: object) -> bool:
        return isinstance(name, str) and self.has(name)

    def __len__(self) -> int:
        return len(self._tables)

    def __iter__(self) -> Iterator[Table]:
        return iter(self.tables())

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"Catalog({len(self._tables)} tables)"
