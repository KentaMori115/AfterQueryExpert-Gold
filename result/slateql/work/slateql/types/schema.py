"""Relation schemas: ordered, named, typed column lists.

A :class:`Schema` is immutable.  Every plan node exposes one, and the executor
uses it to resolve column references to positional offsets exactly once, at
build time, rather than on every row.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Iterable, Iterator, Optional, Sequence

from ..errors import AmbiguousColumnError, SchemaError, UnknownColumnError
from ..util.text import quote_identifier, suggest
from .datatypes import DataType

__all__ = ["Field", "Schema", "EMPTY_SCHEMA"]


@dataclass(frozen=True)
class Field:
    """One column of a relation.

    ``qualifier`` records the relation alias the column came from so that
    ``orders.id`` and ``customers.id`` can coexist in a join output.
    """

    name: str
    dtype: DataType
    qualifier: Optional[str] = None

    @property
    def qualified_name(self) -> str:
        if self.qualifier:
            return f"{self.qualifier}.{self.name}"
        return self.name

    def with_qualifier(self, qualifier: Optional[str]) -> "Field":
        return replace(self, qualifier=qualifier)

    def with_type(self, dtype: DataType) -> "Field":
        return replace(self, dtype=dtype)

    def rename(self, name: str) -> "Field":
        return replace(self, name=name)

    def describe(self) -> str:
        return f"{quote_identifier(self.qualified_name)} {self.dtype}"

    def __str__(self) -> str:  # pragma: no cover - trivial
        return f"{self.qualified_name}: {self.dtype}"


class Schema:
    """An ordered collection of :class:`Field` objects."""

    __slots__ = ("_fields", "_by_name")

    def __init__(self, fields: Iterable[Field]) -> None:
        self._fields: tuple[Field, ...] = tuple(fields)
        by_name: dict[str, list[int]] = {}
        for index, field in enumerate(self._fields):
            by_name.setdefault(field.name, []).append(index)
        self._by_name = by_name

    # -- construction ---------------------------------------------------

    @classmethod
    def of(cls, *pairs: tuple[str, DataType]) -> "Schema":
        """Build a schema from ``(name, dtype)`` pairs."""

        return cls(Field(name, dtype) for name, dtype in pairs)

    @classmethod
    def empty(cls) -> "Schema":
        return cls(())

    # -- sequence protocol ----------------------------------------------

    @property
    def fields(self) -> tuple[Field, ...]:
        return self._fields

    def __len__(self) -> int:
        return len(self._fields)

    def __iter__(self) -> Iterator[Field]:
        return iter(self._fields)

    def __getitem__(self, index: int) -> Field:
        return self._fields[index]

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, Schema):
            return NotImplemented
        return self._fields == other._fields

    def __hash__(self) -> int:
        return hash(self._fields)

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        inner = ", ".join(str(field) for field in self._fields)
        return f"Schema({inner})"

    # -- lookup ----------------------------------------------------------

    @property
    def names(self) -> list[str]:
        return [field.name for field in self._fields]

    @property
    def qualified_names(self) -> list[str]:
        return [field.qualified_name for field in self._fields]

    @property
    def types(self) -> list[DataType]:
        return [field.dtype for field in self._fields]

    def index_of(self, name: str, qualifier: Optional[str] = None) -> int:
        """Resolve a column reference to its positional offset.

        Raises :class:`UnknownColumnError` when nothing matches and
        :class:`AmbiguousColumnError` when an unqualified name matches more
        than one field.
        """

        candidates = self._by_name.get(name, [])
        if qualifier is not None:
            candidates = [
                index
                for index in candidates
                if self._fields[index].qualifier == qualifier
            ]
        if not candidates:
            reference = f"{qualifier}.{name}" if qualifier else name
            hints = suggest(name, self.names)
            raise UnknownColumnError(
                f"no such column: {reference}",
                hint=("did you mean " + ", ".join(hints) + "?") if hints else None,
            )
        if len(candidates) > 1:
            owners = sorted(
                {self._fields[i].qualifier or "<unqualified>" for i in candidates}
            )
            raise AmbiguousColumnError(
                f"column reference {name!r} is ambiguous",
                hint="qualify it with one of: " + ", ".join(owners),
            )
        return candidates[0]

    def try_index_of(self, name: str, qualifier: Optional[str] = None) -> Optional[int]:
        """Like :meth:`index_of` but returns ``None`` instead of raising."""

        try:
            return self.index_of(name, qualifier)
        except (UnknownColumnError, AmbiguousColumnError):
            return None

    def field(self, name: str, qualifier: Optional[str] = None) -> Field:
        return self._fields[self.index_of(name, qualifier)]

    def has(self, name: str, qualifier: Optional[str] = None) -> bool:
        return self.try_index_of(name, qualifier) is not None

    def indices_for_qualifier(self, qualifier: str) -> list[int]:
        """Positions of every field belonging to ``qualifier``."""

        return [
            index
            for index, field in enumerate(self._fields)
            if field.qualifier == qualifier
        ]

    # -- derivation ------------------------------------------------------

    def project(self, indices: Sequence[int]) -> "Schema":
        """Return a schema containing only ``indices``, in that order."""

        try:
            return Schema(self._fields[index] for index in indices)
        except IndexError as exc:
            raise SchemaError("projection index out of range") from exc

    def select(self, names: Sequence[str]) -> "Schema":
        return self.project([self.index_of(name) for name in names])

    def merge(self, other: "Schema") -> "Schema":
        """Concatenate two schemas, as a join does."""

        return Schema(self._fields + other._fields)

    def qualified(self, qualifier: Optional[str]) -> "Schema":
        """Return a copy where every field carries ``qualifier``."""

        return Schema(field.with_qualifier(qualifier) for field in self._fields)

    def rename(self, names: Sequence[str]) -> "Schema":
        if len(names) != len(self._fields):
            raise SchemaError(
                f"cannot rename {len(self._fields)} columns with {len(names)} names"
            )
        return Schema(
            field.rename(name) for field, name in zip(self._fields, names)
        )

    def with_nullable(self, nullable: bool = True) -> "Schema":
        """Return a copy where every field's type has the given nullability."""

        return Schema(
            field.with_type(field.dtype.as_nullable(nullable))
            for field in self._fields
        )

    def describe(self) -> str:
        """Multi-line human readable rendering used by ``\\d`` in the CLI."""

        if not self._fields:
            return "(no columns)"
        width = max(len(field.qualified_name) for field in self._fields)
        return "\n".join(
            f"{field.qualified_name.ljust(width)}  {field.dtype}"
            for field in self._fields
        )


EMPTY_SCHEMA = Schema.empty()
