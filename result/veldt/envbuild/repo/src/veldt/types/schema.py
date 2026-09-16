"""Fields and schemas.

A :class:`Schema` is an ordered, immutable list of :class:`Field` objects. Every
batch, table, plan node and operator carries one. Name lookup is
case-insensitive, matching SQL's usual behaviour, but the original spelling is
preserved for display.
"""

from __future__ import annotations

from dataclasses import dataclass, field as dataclass_field
from typing import Any, Dict, Iterable, Iterator, List, Mapping, Optional, Sequence, Tuple

from ..errors import ColumnNotFoundError, DuplicateColumnError
from .dtypes import DataType, common_type, parse_dtype

__all__ = ["Field", "Schema"]


@dataclass(frozen=True)
class Field:
    """A single named, typed column slot.

    Attributes:
        name: The column name as written by the user.
        dtype: The column's data type.
        nullable: Whether the column may contain ``None``. Defaults to true
            because most real inputs have gaps.
        metadata: Free-form annotations attached by readers, for example the
            partition key a column was derived from.
    """

    name: str
    dtype: DataType
    nullable: bool = True
    metadata: Mapping[str, str] = dataclass_field(default_factory=dict)

    def __post_init__(self) -> None:
        if not isinstance(self.name, str) or not self.name:
            raise ValueError("field name must be a non-empty string")
        object.__setattr__(self, "dtype", parse_dtype(self.dtype))
        object.__setattr__(self, "metadata", dict(self.metadata))

    def rename(self, name: str) -> "Field":
        """Return a copy of this field under a new name."""
        return Field(name, self.dtype, self.nullable, self.metadata)

    def with_dtype(self, dtype: DataType) -> "Field":
        """Return a copy of this field with a different type."""
        return Field(self.name, parse_dtype(dtype), self.nullable, self.metadata)

    def with_nullable(self, nullable: bool) -> "Field":
        """Return a copy of this field with a different nullability."""
        return Field(self.name, self.dtype, nullable, self.metadata)

    def with_metadata(self, **entries: str) -> "Field":
        """Return a copy of this field with extra metadata merged in."""
        merged = dict(self.metadata)
        merged.update(entries)
        return Field(self.name, self.dtype, self.nullable, merged)

    def matches(self, name: str) -> bool:
        """True when ``name`` refers to this field, ignoring case."""
        return self.name.lower() == name.lower()

    def to_dict(self) -> Dict[str, Any]:
        """Return a JSON-friendly representation."""
        payload: Dict[str, Any] = {
            "name": self.name,
            "dtype": str(self.dtype),
            "nullable": self.nullable,
        }
        if self.metadata:
            payload["metadata"] = dict(self.metadata)
        return payload

    @classmethod
    def from_dict(cls, payload: Mapping[str, Any]) -> "Field":
        """Rebuild a field from :meth:`to_dict` output."""
        return cls(
            name=payload["name"],
            dtype=parse_dtype(payload["dtype"]),
            nullable=bool(payload.get("nullable", True)),
            metadata=payload.get("metadata", {}),
        )

    def __str__(self) -> str:
        suffix = "" if self.nullable else " not null"
        return f"{self.name} {self.dtype}{suffix}"


class Schema:
    """An ordered collection of uniquely named fields."""

    __slots__ = ("_fields", "_index")

    def __init__(self, fields: Iterable[Field | Tuple[str, Any]] = ()) -> None:
        resolved: List[Field] = []
        index: Dict[str, int] = {}
        for entry in fields:
            item = entry if isinstance(entry, Field) else Field(entry[0], parse_dtype(entry[1]))
            key = item.name.lower()
            if key in index:
                raise DuplicateColumnError(item.name)
            index[key] = len(resolved)
            resolved.append(item)
        self._fields: Tuple[Field, ...] = tuple(resolved)
        self._index: Dict[str, int] = index

    # ------------------------------------------------------------------
    # Construction helpers
    # ------------------------------------------------------------------
    @classmethod
    def from_pairs(cls, pairs: Iterable[Tuple[str, Any]]) -> "Schema":
        """Build a schema from ``(name, dtype)`` pairs."""
        return cls(Field(name, parse_dtype(dtype)) for name, dtype in pairs)

    @classmethod
    def from_dict(cls, payload: Mapping[str, Any]) -> "Schema":
        """Rebuild a schema from :meth:`to_dict` output."""
        return cls(Field.from_dict(entry) for entry in payload["fields"])

    @classmethod
    def empty(cls) -> "Schema":
        """Return a schema with no columns."""
        return cls(())

    # ------------------------------------------------------------------
    # Basic access
    # ------------------------------------------------------------------
    @property
    def fields(self) -> Tuple[Field, ...]:
        """The fields in declaration order."""
        return self._fields

    @property
    def names(self) -> List[str]:
        """Column names in declaration order."""
        return [item.name for item in self._fields]

    @property
    def dtypes(self) -> List[DataType]:
        """Column types in declaration order."""
        return [item.dtype for item in self._fields]

    def __len__(self) -> int:
        return len(self._fields)

    def __iter__(self) -> Iterator[Field]:
        return iter(self._fields)

    def __getitem__(self, key: int | str) -> Field:
        if isinstance(key, int):
            return self._fields[key]
        return self.field(key)

    def __contains__(self, name: object) -> bool:
        return isinstance(name, str) and name.lower() in self._index

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, Schema):
            return NotImplemented
        return self._fields == other._fields

    def __hash__(self) -> int:
        return hash(self._fields)

    def __repr__(self) -> str:
        rendered = ", ".join(str(item) for item in self._fields)
        return f"Schema({rendered})"

    def has(self, name: str) -> bool:
        """True when a column with ``name`` exists, ignoring case."""
        return name.lower() in self._index

    def index_of(self, name: str) -> int:
        """Return the position of ``name``.

        Raises:
            ColumnNotFoundError: If no column matches.
        """
        try:
            return self._index[name.lower()]
        except KeyError:
            raise ColumnNotFoundError(name, self.names) from None

    def field(self, name: str) -> Field:
        """Return the field called ``name``.

        Raises:
            ColumnNotFoundError: If no column matches.
        """
        return self._fields[self.index_of(name)]

    def dtype_of(self, name: str) -> DataType:
        """Return the type of the column called ``name``."""
        return self.field(name).dtype

    # ------------------------------------------------------------------
    # Derivation
    # ------------------------------------------------------------------
    def select(self, names: Sequence[str]) -> "Schema":
        """Return a schema containing only ``names``, in the order given."""
        return Schema(self.field(name) for name in names)

    def project(self, indices: Sequence[int]) -> "Schema":
        """Return a schema built from positional indices."""
        return Schema(self._fields[index] for index in indices)

    def add(self, item: Field, position: Optional[int] = None) -> "Schema":
        """Return a copy with ``item`` inserted, appending by default."""
        fields = list(self._fields)
        if position is None:
            fields.append(item)
        else:
            fields.insert(position, item)
        return Schema(fields)

    def remove(self, name: str) -> "Schema":
        """Return a copy without the column called ``name``."""
        position = self.index_of(name)
        return Schema(item for index, item in enumerate(self._fields) if index != position)

    def rename(self, mapping: Mapping[str, str]) -> "Schema":
        """Return a copy with columns renamed according to ``mapping``.

        Keys are matched case-insensitively; columns absent from the mapping
        keep their current name.
        """
        lowered = {key.lower(): value for key, value in mapping.items()}
        return Schema(
            item.rename(lowered[item.name.lower()]) if item.name.lower() in lowered else item
            for item in self._fields
        )

    def merge(self, other: "Schema", suffix: str = "_right") -> "Schema":
        """Concatenate two schemas, disambiguating collisions with ``suffix``.

        Used by joins, where both sides may carry an ``id`` column. The right
        side's duplicate is renamed; if that name also collides, a numeric
        counter is appended until the name is free.
        """
        fields = list(self._fields)
        taken = {item.name.lower() for item in fields}
        for item in other:
            name = item.name
            if name.lower() in taken:
                candidate = f"{name}{suffix}"
                counter = 1
                while candidate.lower() in taken:
                    counter += 1
                    candidate = f"{name}{suffix}{counter}"
                name = candidate
            taken.add(name.lower())
            fields.append(item.rename(name))
        return Schema(fields)

    def with_nullable(self, nullable: bool) -> "Schema":
        """Return a copy where every field has the given nullability."""
        return Schema(item.with_nullable(nullable) for item in self._fields)

    def union(self, other: "Schema") -> "Schema":
        """Return the schema of a ``UNION`` between two compatible inputs.

        Column names come from the left side; types are unified pairwise and
        a column is nullable when either side is.

        Raises:
            ValueError: If the two schemas have different column counts.
        """
        if len(self) != len(other):
            raise ValueError(
                f"union requires matching column counts: {len(self)} != {len(other)}"
            )
        merged: List[Field] = []
        for left, right in zip(self._fields, other.fields):
            dtype = common_type([left.dtype, right.dtype], context="union")
            merged.append(Field(left.name, dtype, left.nullable or right.nullable))
        return Schema(merged)

    # ------------------------------------------------------------------
    # Serialisation and display
    # ------------------------------------------------------------------
    def to_dict(self) -> Dict[str, Any]:
        """Return a JSON-friendly representation."""
        return {"fields": [item.to_dict() for item in self._fields]}

    def describe(self) -> str:
        """Return a multi-line human readable description."""
        if not self._fields:
            return "(no columns)"
        width = max(len(item.name) for item in self._fields)
        lines = []
        for item in self._fields:
            flag = "" if item.nullable else "  NOT NULL"
            lines.append(f"{item.name.ljust(width)}  {item.dtype}{flag}")
        return "\n".join(lines)
