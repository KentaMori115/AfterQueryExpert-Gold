"""The engine's data types and the rules for combining them.

``veldt`` has a deliberately small type lattice. Six types cover everything the
readers can produce and everything the expression language can compute:

======================  ==========================
Type                    Python representation
======================  ==========================
``DataType.INT64``      ``int``
``DataType.FLOAT64``    ``float``
``DataType.BOOL``       ``bool``
``DataType.STRING``     ``str``
``DataType.TIMESTAMP``  ``datetime.datetime``
``DataType.NULL``       ``None`` only
======================  ==========================

``NULL`` is the type of an expression that can only ever produce ``None`` (the
literal ``NULL``, or an empty column of unknown provenance). It unifies with
everything, which is what makes ``COALESCE(x, NULL)`` type-check.
"""

from __future__ import annotations

from datetime import date, datetime
from enum import Enum
from typing import Any, Iterable, Optional, Sequence

from ..errors import TypeMismatchError

__all__ = [
    "DataType",
    "NUMERIC_TYPES",
    "ORDERED_TYPES",
    "is_numeric",
    "is_ordered",
    "python_type",
    "infer_dtype",
    "parse_dtype",
    "promote",
    "unify",
    "common_type",
]


class DataType(str, Enum):
    """The set of column types the engine understands.

    Inheriting from :class:`str` means a ``DataType`` can be used directly in
    formatted messages and compares equal to its own name, which keeps schema
    serialisation trivial.
    """

    INT64 = "int64"
    FLOAT64 = "float64"
    BOOL = "bool"
    STRING = "string"
    TIMESTAMP = "timestamp"
    NULL = "null"

    def __str__(self) -> str:
        return self.value

    def __repr__(self) -> str:
        return f"DataType.{self.name}"

    @property
    def is_numeric(self) -> bool:
        """True for the integer and floating point types."""
        return self in NUMERIC_TYPES

    @property
    def is_ordered(self) -> bool:
        """True when values of this type support ``<`` and ``>``."""
        return self in ORDERED_TYPES


NUMERIC_TYPES = frozenset({DataType.INT64, DataType.FLOAT64})
ORDERED_TYPES = frozenset(
    {DataType.INT64, DataType.FLOAT64, DataType.STRING, DataType.TIMESTAMP, DataType.BOOL}
)

_PYTHON_TYPES = {
    DataType.INT64: int,
    DataType.FLOAT64: float,
    DataType.BOOL: bool,
    DataType.STRING: str,
    DataType.TIMESTAMP: datetime,
    DataType.NULL: type(None),
}

_ALIASES = {
    "int": DataType.INT64,
    "integer": DataType.INT64,
    "bigint": DataType.INT64,
    "int64": DataType.INT64,
    "long": DataType.INT64,
    "float": DataType.FLOAT64,
    "double": DataType.FLOAT64,
    "real": DataType.FLOAT64,
    "float64": DataType.FLOAT64,
    "numeric": DataType.FLOAT64,
    "bool": DataType.BOOL,
    "boolean": DataType.BOOL,
    "str": DataType.STRING,
    "string": DataType.STRING,
    "text": DataType.STRING,
    "varchar": DataType.STRING,
    "char": DataType.STRING,
    "timestamp": DataType.TIMESTAMP,
    "datetime": DataType.TIMESTAMP,
    "date": DataType.TIMESTAMP,
    "null": DataType.NULL,
    "none": DataType.NULL,
}

# Widening order used when unifying two numeric types.
_NUMERIC_RANK = {DataType.INT64: 1, DataType.FLOAT64: 2}


def is_numeric(dtype: DataType) -> bool:
    """True when ``dtype`` participates in arithmetic."""
    return dtype in NUMERIC_TYPES


def is_ordered(dtype: DataType) -> bool:
    """True when ``dtype`` supports ordering comparisons."""
    return dtype in ORDERED_TYPES


def python_type(dtype: DataType) -> type:
    """Return the Python class used to hold values of ``dtype``."""
    return _PYTHON_TYPES[dtype]


def parse_dtype(name: str | DataType) -> DataType:
    """Resolve a type name or alias to a :class:`DataType`.

    Args:
        name: Either a ``DataType`` (returned unchanged) or a spelling such as
            ``"BIGINT"``, ``"varchar"`` or ``"double"``.

    Raises:
        ValueError: If the name is not a recognised type or alias.
    """
    if isinstance(name, DataType):
        return name
    key = str(name).strip().lower()
    if key in _ALIASES:
        return _ALIASES[key]
    raise ValueError(f"unknown data type {name!r}")


def infer_dtype(value: Any) -> DataType:
    """Return the type that best describes a single Python value.

    ``bool`` is checked before ``int`` because Python booleans are integers.
    """
    if value is None:
        return DataType.NULL
    if isinstance(value, bool):
        return DataType.BOOL
    if isinstance(value, int):
        return DataType.INT64
    if isinstance(value, float):
        return DataType.FLOAT64
    if isinstance(value, str):
        return DataType.STRING
    if isinstance(value, (datetime, date)):
        return DataType.TIMESTAMP
    raise TypeError(f"no veldt type for Python value of type {type(value).__name__}")


def promote(left: DataType, right: DataType) -> Optional[DataType]:
    """Return the type both operands widen to, or ``None`` when incompatible.

    ``NULL`` widens to whatever it is paired with. Numeric types widen towards
    ``FLOAT64``. Every other pairing must already be identical.
    """
    if left == right:
        return left
    if left == DataType.NULL:
        return right
    if right == DataType.NULL:
        return left
    if left in NUMERIC_TYPES and right in NUMERIC_TYPES:
        return left if _NUMERIC_RANK[left] >= _NUMERIC_RANK[right] else right
    return None


def unify(left: DataType, right: DataType, *, context: str = "expression") -> DataType:
    """Like :func:`promote`, but raise instead of returning ``None``.

    Raises:
        TypeMismatchError: If the two types have no common supertype.
    """
    result = promote(left, right)
    if result is None:
        raise TypeMismatchError(
            f"incompatible types in {context}: {left} and {right}",
            operator=context,
        )
    return result


def common_type(dtypes: Iterable[DataType], *, context: str = "expression") -> DataType:
    """Fold :func:`unify` across a sequence of types.

    An empty sequence yields ``NULL``, matching the type of an expression that
    has no branches able to produce a value.
    """
    result: Optional[DataType] = None
    for dtype in dtypes:
        result = dtype if result is None else unify(result, dtype, context=context)
    return result if result is not None else DataType.NULL


def describe_types(dtypes: Sequence[DataType]) -> str:
    """Render a list of types for use in error messages."""
    return ", ".join(str(dtype) for dtype in dtypes)
