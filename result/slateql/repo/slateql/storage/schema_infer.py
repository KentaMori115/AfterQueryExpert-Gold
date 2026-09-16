"""Schema inference for text-shaped sources.

Text formats do not carry types, so the loaders sample rows and pick the
narrowest type that fits every sampled value.  The order of preference is
BOOLEAN, INTEGER, DOUBLE, DATE, TIMESTAMP, STRING -- STRING always succeeds, so
inference never fails outright.
"""

from __future__ import annotations

from typing import Any, Optional, Sequence

from ..types.datatypes import (
    BOOLEAN,
    DATE,
    DOUBLE,
    INTEGER,
    STRING,
    TIMESTAMP,
    DataType,
)
from ..types.schema import Field, Schema
from ..types.values import parse_bool, parse_date, parse_timestamp

__all__ = [
    "parse_scalar",
    "infer_schema_from_rows",
    "infer_field_type",
    "widen",
    "looks_temporal",
    "coerce_json_scalar",
]

_LADDER = (BOOLEAN, INTEGER, DOUBLE, DATE, TIMESTAMP, STRING)


def parse_scalar(text: str) -> Any:
    """Convert a text cell into the narrowest Python value that fits."""

    stripped = text.strip()
    if not stripped:
        return None
    boolean = parse_bool(stripped)
    if boolean is not None and stripped.lower() in ("true", "false"):
        return boolean
    try:
        return int(stripped)
    except ValueError:
        pass
    try:
        value = float(stripped)
    except ValueError:
        pass
    else:
        return value
    stamp = parse_date(stripped)
    if stamp is not None:
        return stamp
    moment = parse_timestamp(stripped)
    if moment is not None:
        return moment
    return text


def _fits(value: Any, dtype: DataType) -> bool:
    """Whether ``value`` can be represented by ``dtype`` without loss."""

    import datetime as _dt

    if value is None:
        return True
    if dtype is BOOLEAN:
        return isinstance(value, bool)
    if dtype is INTEGER:
        return isinstance(value, int) and not isinstance(value, bool)
    if dtype is DOUBLE:
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if dtype is DATE:
        return isinstance(value, _dt.date) and not isinstance(value, _dt.datetime)
    if dtype is TIMESTAMP:
        return isinstance(value, (_dt.date, _dt.datetime))
    return True


def infer_field_type(values: Sequence[Any]) -> DataType:
    """Pick the narrowest type on the ladder that fits every sampled value."""

    saw_null = any(value is None for value in values)
    present = [value for value in values if value is not None]
    if not present:
        return STRING.as_nullable(True)
    for candidate in _LADDER:
        if all(_fits(value, candidate) for value in present):
            return candidate.as_nullable(saw_null)
    return STRING.as_nullable(saw_null)


def widen(left: DataType, right: DataType) -> DataType:
    """Return the first ladder entry that accommodates both types."""

    order = {dtype.kind: index for index, dtype in enumerate(_LADDER)}
    if left.kind not in order:
        return left
    if right.kind not in order:
        return right
    chosen = _LADDER[max(order[left.kind], order[right.kind])]
    return chosen.as_nullable(left.nullable or right.nullable)


def infer_schema_from_rows(
    names: Sequence[str],
    rows: Sequence[Sequence[Any]],
    *,
    qualifier: Optional[str] = None,
) -> Schema:
    """Build a schema for ``names`` from sampled ``rows``."""

    columns: list[list[Any]] = [[] for _ in names]
    for row in rows:
        for index, value in enumerate(row):
            if index < len(columns):
                columns[index].append(value)
    return Schema(
        Field(name=name, dtype=infer_field_type(column), qualifier=qualifier)
        for name, column in zip(names, columns)
    )


def looks_temporal(text: str) -> bool:
    """Whether ``text`` starts with an ISO-8601 calendar date.

    JSON has no date type, so temporal values arrive as strings.  Rather than
    trying every parser on every string -- which would turn an eight-digit
    account number into a date -- inference only considers strings that begin
    with ``YYYY-MM-DD``.
    """

    if len(text) < 10:
        return False
    head = text[:10]
    if head[4] != "-" or head[7] != "-":
        return False
    return head[:4].isdigit() and head[5:7].isdigit() and head[8:10].isdigit()


def coerce_json_scalar(value: Any) -> Any:
    """Promote ISO-8601 date and timestamp strings to real temporal values.

    Numbers and booleans are left alone: JSON already distinguishes them, so
    unlike CSV there is nothing to guess.
    """

    if not isinstance(value, str) or not looks_temporal(value):
        return value
    if len(value) == 10:
        parsed = parse_date(value)
        return value if parsed is None else parsed
    stamp = parse_timestamp(value)
    return value if stamp is None else stamp
