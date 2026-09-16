"""Columns: a named, typed, list-backed vector of values.

The engine is column oriented. A column owns its values as a plain Python list
so that slicing and gathering are cheap, and so that a batch can share the same
list object with a projection when no transformation is needed.
"""

from __future__ import annotations

from typing import Any, Callable, Iterable, Iterator, List, Optional, Sequence

from ..types.casting import cast_value
from ..types.dtypes import DataType, infer_dtype, parse_dtype, promote
from ..types.value import is_null, sort_key, values_equal
from ..utils.validation import require_same_length

__all__ = ["Column"]


class Column:
    """A single column of values.

    Attributes:
        name: The column name.
        dtype: The declared type of every non-null value.
        values: The backing list. Treat it as read-only; every operation on a
            column returns a new column rather than mutating in place.
    """

    __slots__ = ("_name", "_dtype", "_values")

    def __init__(self, name: str, dtype: DataType, values: Sequence[Any] = ()) -> None:
        self._name = name
        self._dtype = parse_dtype(dtype)
        self._values: List[Any] = list(values)

    # ------------------------------------------------------------------
    # Construction
    # ------------------------------------------------------------------
    @classmethod
    def from_values(cls, name: str, values: Sequence[Any]) -> "Column":
        """Build a column, inferring its type from the values present.

        A column of only nulls gets :data:`DataType.NULL`; mixed integer and
        floating point values widen to ``FLOAT64``.
        """
        dtype: Optional[DataType] = None
        for value in values:
            if is_null(value):
                continue
            observed = infer_dtype(value)
            dtype = observed if dtype is None else (promote(dtype, observed) or DataType.STRING)
        return cls(name, dtype or DataType.NULL, values)

    @classmethod
    def nulls(cls, name: str, dtype: DataType, length: int) -> "Column":
        """Build a column of ``length`` nulls."""
        return cls(name, dtype, [None] * length)

    @classmethod
    def constant(cls, name: str, value: Any, length: int, dtype: Optional[DataType] = None) -> "Column":
        """Build a column repeating a single value."""
        resolved = dtype if dtype is not None else infer_dtype(value)
        return cls(name, resolved, [value] * length)

    # ------------------------------------------------------------------
    # Basic access
    # ------------------------------------------------------------------
    @property
    def name(self) -> str:
        """The column name."""
        return self._name

    @property
    def dtype(self) -> DataType:
        """The column type."""
        return self._dtype

    @property
    def values(self) -> List[Any]:
        """The backing value list."""
        return self._values

    def __len__(self) -> int:
        return len(self._values)

    def __iter__(self) -> Iterator[Any]:
        return iter(self._values)

    def __getitem__(self, index: int) -> Any:
        return self._values[index]

    def __repr__(self) -> str:
        preview = ", ".join(repr(value) for value in self._values[:5])
        if len(self._values) > 5:
            preview += ", ..."
        return f"Column({self._name!r}, {self._dtype}, [{preview}])"

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, Column):
            return NotImplemented
        return (
            self._name == other._name
            and self._dtype == other._dtype
            and self._values == other._values
        )

    def to_list(self) -> List[Any]:
        """Return a copy of the values as a plain list."""
        return list(self._values)

    # ------------------------------------------------------------------
    # Derivation
    # ------------------------------------------------------------------
    def rename(self, name: str) -> "Column":
        """Return a copy under a new name, sharing the value list."""
        clone = Column.__new__(Column)
        clone._name = name
        clone._dtype = self._dtype
        clone._values = self._values
        return clone

    def take(self, indices: Iterable[int]) -> "Column":
        """Gather values at the given positions, in the order given."""
        return Column(self._name, self._dtype, [self._values[index] for index in indices])

    def filter(self, mask: Sequence[Optional[bool]]) -> "Column":
        """Keep values whose mask entry is exactly ``True``.

        A ``None`` mask entry drops the row, matching SQL's rule that a
        ``WHERE`` clause evaluating to ``NULL`` does not select the row.

        Raises:
            ValueError: If the mask length differs from the column length.
        """
        require_same_length(self._values, mask, "filter mask")
        return Column(
            self._name,
            self._dtype,
            [value for value, keep in zip(self._values, mask) if keep is True],
        )

    def slice(self, offset: int, length: Optional[int] = None) -> "Column":
        """Return a contiguous window of the column."""
        if offset < 0:
            raise ValueError("slice offset must not be negative")
        end = len(self._values) if length is None else offset + max(length, 0)
        return Column(self._name, self._dtype, self._values[offset:end])

    def map(self, function: Callable[[Any], Any], dtype: Optional[DataType] = None) -> "Column":
        """Apply ``function`` to every value, skipping nulls.

        Nulls stay null without the function being called, which spares every
        scalar implementation from repeating a null check.
        """
        mapped = [None if is_null(value) else function(value) for value in self._values]
        if dtype is not None:
            return Column(self._name, dtype, mapped)
        return Column.from_values(self._name, mapped)

    def cast(self, dtype: DataType) -> "Column":
        """Return a copy with every value converted to ``dtype``."""
        target = parse_dtype(dtype)
        if target == self._dtype:
            return self
        return Column(self._name, target, [cast_value(value, target) for value in self._values])

    def append(self, value: Any) -> "Column":
        """Return a copy with one extra value at the end."""
        return Column(self._name, self._dtype, self._values + [value])

    def concat(self, other: "Column") -> "Column":
        """Return a copy with ``other``'s values appended."""
        dtype = promote(self._dtype, other.dtype) or DataType.STRING
        return Column(self._name, dtype, self._values + other.values)

    # ------------------------------------------------------------------
    # Statistics
    # ------------------------------------------------------------------
    def null_count(self) -> int:
        """Return how many values are null."""
        return sum(1 for value in self._values if is_null(value))

    def is_all_null(self) -> bool:
        """True when the column holds no non-null values."""
        return all(is_null(value) for value in self._values)

    def distinct_count(self) -> int:
        """Return the number of distinct non-null values."""
        from ..utils.hashing import value_key

        return len({value_key(value) for value in self._values if not is_null(value)})

    def min_value(self) -> Any:
        """Return the smallest non-null value, or ``None`` when empty."""
        present = [value for value in self._values if not is_null(value)]
        return min(present, key=sort_key) if present else None

    def max_value(self) -> Any:
        """Return the largest non-null value, or ``None`` when empty."""
        present = [value for value in self._values if not is_null(value)]
        return max(present, key=sort_key) if present else None

    def contains(self, needle: Any) -> bool:
        """True when any value equals ``needle`` under SQL equality."""
        return any(values_equal(value, needle) is True for value in self._values)
