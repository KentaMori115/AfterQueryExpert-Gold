"""Schema inference for text formats.

CSV has no types, so the reader has to guess. The rules are deliberately
conservative and ordered from most to least specific:

1. If every non-null sample parses as an integer, the column is ``INT64``.
2. Otherwise, if every non-null sample parses as a float, it is ``FLOAT64``.
3. Otherwise, if every non-null sample is a boolean spelling, it is ``BOOL``.
4. Otherwise, if every non-null sample parses as a timestamp, it is
   ``TIMESTAMP``.
5. Otherwise the column is ``STRING``.

A column whose samples are all null gets ``STRING``, because that is the type
whose values a later batch is most likely to be readable as.
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence

from ..types.dtypes import DataType
from ..types.value import FALSE_LITERALS, TRUE_LITERALS
from ..types.schema import Field, Schema
from ..utils.timeparse import try_parse_timestamp

__all__ = [
    "DEFAULT_NULL_VALUES",
    "infer_column_type",
    "infer_schema",
    "parse_text_value",
    "normalize_header",
]

DEFAULT_NULL_VALUES = frozenset({"", "null", "none", "nan", "na", "n/a", "\\n"})

# Order matters: the first type every sample satisfies wins.
_CANDIDATES = (
    DataType.INT64,
    DataType.FLOAT64,
    DataType.BOOL,
    DataType.TIMESTAMP,
)


def is_null_text(text: str, null_values: Iterable[str] = DEFAULT_NULL_VALUES) -> bool:
    """True when a raw text cell should be read as null."""
    return text.strip().lower() in {value.lower() for value in null_values}


def _matches(text: str, dtype: DataType) -> bool:
    """True when a raw cell parses as ``dtype``."""
    candidate = text.strip()
    if dtype == DataType.INT64:
        try:
            int(candidate)
            return True
        except ValueError:
            return False
    if dtype == DataType.FLOAT64:
        try:
            float(candidate)
            return True
        except ValueError:
            return False
    if dtype == DataType.BOOL:
        lowered = candidate.lower()
        return lowered in TRUE_LITERALS or lowered in FALSE_LITERALS
    if dtype == DataType.TIMESTAMP:
        return try_parse_timestamp(candidate) is not None
    return True


def infer_column_type(
    samples: Sequence[str], null_values: Iterable[str] = DEFAULT_NULL_VALUES
) -> DataType:
    """Infer one column's type from raw text samples."""
    nulls = {value.lower() for value in null_values}
    present = [item for item in samples if item.strip().lower() not in nulls]
    if not present:
        return DataType.STRING
    for candidate in _CANDIDATES:
        if all(_matches(item, candidate) for item in present):
            # A column of only 0/1 reads more usefully as an integer.
            if candidate == DataType.BOOL and all(
                item.strip() in ("0", "1") for item in present
            ):
                return DataType.INT64
            return candidate
    return DataType.STRING


def infer_schema(
    header: Sequence[str],
    rows: Sequence[Sequence[str]],
    null_values: Iterable[str] = DEFAULT_NULL_VALUES,
) -> Schema:
    """Infer a schema from a header and a sample of raw rows.

    Rows shorter than the header contribute nothing for the missing columns;
    rows longer than the header have their extra cells ignored.
    """
    names = normalize_header(header)
    fields: List[Field] = []
    for index, name in enumerate(names):
        samples = [row[index] for row in rows if index < len(row)]
        nullable = any(
            index >= len(row) or is_null_text(row[index], null_values) for row in rows
        )
        fields.append(Field(name, infer_column_type(samples, null_values), nullable or not rows))
    return Schema(fields)


def normalize_header(header: Sequence[str]) -> List[str]:
    """Clean up header cells into usable, unique column names.

    Blank cells become ``column_1``-style placeholders, and repeated names get
    a numeric suffix so the schema can be constructed at all.
    """
    names: List[str] = []
    taken: set = set()
    for index, raw in enumerate(header):
        name = raw.strip()
        if not name:
            name = f"column_{index + 1}"
        candidate = name
        counter = 1
        while candidate.lower() in taken:
            counter += 1
            candidate = f"{name}_{counter}"
        taken.add(candidate.lower())
        names.append(candidate)
    return names


def parse_text_value(
    text: str, dtype: DataType, null_values: Iterable[str] = DEFAULT_NULL_VALUES
) -> Any:
    """Convert one raw cell into a typed value.

    A cell that cannot be parsed as the column's type becomes null rather than
    raising: a single malformed row should not abort a scan of a large file.
    """
    if is_null_text(text, null_values):
        return None
    candidate = text.strip()
    if dtype == DataType.STRING:
        return text
    if dtype == DataType.INT64:
        try:
            return int(candidate)
        except ValueError:
            return None
    if dtype == DataType.FLOAT64:
        try:
            return float(candidate)
        except ValueError:
            return None
    if dtype == DataType.BOOL:
        lowered = candidate.lower()
        if lowered in TRUE_LITERALS:
            return True
        if lowered in FALSE_LITERALS:
            return False
        return None
    if dtype == DataType.TIMESTAMP:
        return try_parse_timestamp(candidate)
    return text


def coerce_json_value(value: Any, dtype: DataType) -> Any:
    """Convert a value decoded from JSON into the column's type.

    JSON already carries types, so this only has to reconcile the cases where
    the decoded type and the column type disagree.
    """
    from ..types.casting import try_cast_value
    from ..types.value import is_null

    if is_null(value):
        return None
    if dtype == DataType.STRING and not isinstance(value, str):
        return try_cast_value(value, dtype)
    if dtype == DataType.TIMESTAMP and isinstance(value, str):
        return try_parse_timestamp(value)
    if dtype == DataType.INT64 and isinstance(value, bool):
        return int(value)
    if dtype == DataType.FLOAT64 and isinstance(value, int) and not isinstance(value, bool):
        return float(value)
    if dtype == DataType.INT64 and isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def infer_schema_from_records(
    records: Sequence[Mapping[str, Any]], sample_size: Optional[int] = None
) -> Schema:
    """Infer a schema from decoded JSON objects, preserving key order."""
    from ..types.dtypes import infer_dtype, promote
    from ..types.value import is_null

    sample = records if sample_size is None else records[:sample_size]
    order: List[str] = []
    types: Dict[str, DataType] = {}
    nullable: Dict[str, bool] = {}
    for record in sample:
        for key in order:
            if key not in record:
                nullable[key] = True
        for key, value in record.items():
            if key not in types:
                order.append(key)
                types[key] = DataType.NULL
                nullable[key] = len(order) > 0 and record is not sample[0]
            if is_null(value):
                nullable[key] = True
                continue
            observed = infer_dtype(value)
            merged = promote(types[key], observed)
            types[key] = merged if merged is not None else DataType.STRING
    return Schema(
        Field(name, types[name] if types[name] != DataType.NULL else DataType.STRING, True)
        for name in order
    )
