"""The SlateQL logical type system.

Types are value objects: two :class:`DataType` instances describing the same
kind and nullability compare equal and hash identically, which lets the binder
memoise type computations.  Nullability is tracked but never used to reject a
query outright -- it only feeds schema reporting and optimizer reasoning about
null-rejecting predicates.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Optional

from ..errors import SchemaError
from .interval import Interval

__all__ = [
    "TypeKind",
    "DataType",
    "NULL",
    "BOOLEAN",
    "INTEGER",
    "DOUBLE",
    "STRING",
    "DATE",
    "TIMESTAMP",
    "INTERVAL",
    "ALL_TYPES",
    "parse_type_name",
    "type_from_python",
]


class TypeKind(Enum):
    """Enumeration of every logical type the engine understands."""

    NULL = "null"
    BOOLEAN = "boolean"
    INTEGER = "integer"
    DOUBLE = "double"
    STRING = "string"
    DATE = "date"
    TIMESTAMP = "timestamp"
    INTERVAL = "interval"

    def __str__(self) -> str:  # pragma: no cover - trivial
        return self.value


_NUMERIC = frozenset({TypeKind.INTEGER, TypeKind.DOUBLE})
_TEMPORAL = frozenset({TypeKind.DATE, TypeKind.TIMESTAMP})
_ORDERED = _NUMERIC | _TEMPORAL | {TypeKind.STRING, TypeKind.BOOLEAN, TypeKind.INTERVAL}


@dataclass(frozen=True)
class DataType:
    """A logical type together with its nullability flag."""

    kind: TypeKind
    nullable: bool = True

    @property
    def name(self) -> str:
        """The canonical uppercase SQL spelling of this type."""

        return self.kind.value.upper()

    @property
    def is_numeric(self) -> bool:
        return self.kind in _NUMERIC

    @property
    def is_temporal(self) -> bool:
        return self.kind in _TEMPORAL

    @property
    def is_ordered(self) -> bool:
        """Whether values of this type support ``<`` and ORDER BY."""

        return self.kind in _ORDERED

    @property
    def is_null(self) -> bool:
        return self.kind is TypeKind.NULL

    def as_nullable(self, nullable: bool = True) -> "DataType":
        """Return the same kind with an explicit nullability."""

        if nullable == self.nullable:
            return self
        return DataType(self.kind, nullable)

    def __str__(self) -> str:
        suffix = "" if self.nullable else " NOT NULL"
        return f"{self.name}{suffix}"

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"DataType({self.name}, nullable={self.nullable})"


NULL = DataType(TypeKind.NULL, nullable=True)
BOOLEAN = DataType(TypeKind.BOOLEAN)
INTEGER = DataType(TypeKind.INTEGER)
DOUBLE = DataType(TypeKind.DOUBLE)
STRING = DataType(TypeKind.STRING)
DATE = DataType(TypeKind.DATE)
TIMESTAMP = DataType(TypeKind.TIMESTAMP)
INTERVAL = DataType(TypeKind.INTERVAL)

ALL_TYPES = (NULL, BOOLEAN, INTEGER, DOUBLE, STRING, DATE, TIMESTAMP, INTERVAL)

_ALIASES = {
    "null": TypeKind.NULL,
    "bool": TypeKind.BOOLEAN,
    "boolean": TypeKind.BOOLEAN,
    "int": TypeKind.INTEGER,
    "integer": TypeKind.INTEGER,
    "bigint": TypeKind.INTEGER,
    "smallint": TypeKind.INTEGER,
    "double": TypeKind.DOUBLE,
    "float": TypeKind.DOUBLE,
    "real": TypeKind.DOUBLE,
    "decimal": TypeKind.DOUBLE,
    "numeric": TypeKind.DOUBLE,
    "string": TypeKind.STRING,
    "text": TypeKind.STRING,
    "varchar": TypeKind.STRING,
    "char": TypeKind.STRING,
    "date": TypeKind.DATE,
    "timestamp": TypeKind.TIMESTAMP,
    "datetime": TypeKind.TIMESTAMP,
    "interval": TypeKind.INTERVAL,
}


def parse_type_name(name: str, *, nullable: bool = True) -> DataType:
    """Resolve a SQL type name (including common aliases) to a type.

    Raises :class:`slateql.errors.SchemaError` for unknown names so that both
    CAST parsing and external schema declarations report the same message.
    """

    key = name.strip().lower()
    kind = _ALIASES.get(key)
    if kind is None:
        raise SchemaError(
            f"unknown type name: {name!r}",
            hint="supported types: " + ", ".join(sorted({k.value for k in TypeKind})),
        )
    return DataType(kind, nullable)


def type_from_python(value: object) -> DataType:
    """Infer the logical type of a Python value.

    ``bool`` is checked before ``int`` because ``bool`` is a subclass of
    ``int`` in Python and would otherwise be typed as INTEGER.
    """

    import datetime as _dt

    if value is None:
        return NULL
    if isinstance(value, bool):
        return BOOLEAN
    if isinstance(value, int):
        return INTEGER
    if isinstance(value, float):
        return DOUBLE
    if isinstance(value, str):
        return STRING
    if isinstance(value, _dt.datetime):
        return TIMESTAMP
    if isinstance(value, _dt.date):
        return DATE
    if isinstance(value, (Interval, _dt.timedelta)):
        return INTERVAL
    raise SchemaError(f"unsupported Python value of type {type(value).__name__}")


def widest(kinds: Optional[list[TypeKind]] = None) -> DataType:
    """Return the widest numeric type among ``kinds`` (DOUBLE beats INTEGER)."""

    if not kinds:
        return NULL
    if TypeKind.DOUBLE in kinds:
        return DOUBLE
    if TypeKind.INTEGER in kinds:
        return INTEGER
    return DataType(kinds[0])
