"""Writers for tables and query results.

Every writer renders values through :func:`veldt.types.value.format_value`, so
a timestamp written to CSV and printed to the terminal look the same.
"""

from __future__ import annotations

import csv
import io
import json
from typing import Any, Iterable, List, Optional, Sequence, TextIO

from ..core.table import Table
from ..types.dtypes import DataType
from ..types.value import format_value, is_null
from .formats import Format, delimiter_for, detect_format

__all__ = [
    "write_csv",
    "write_jsonl",
    "write_file",
    "to_csv_string",
    "to_jsonl_string",
]


def to_csv_string(
    table: Table,
    delimiter: str = ",",
    header: bool = True,
    null_text: str = "",
) -> str:
    """Render a table as delimited text."""
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=delimiter, lineterminator="\n")
    if header:
        writer.writerow(table.column_names)
    for row in table.tuples():
        writer.writerow(
            [null_text if is_null(value) else format_value(value) for value in row]
        )
    return buffer.getvalue()


def write_csv(
    table: Table,
    path: str,
    delimiter: str = ",",
    header: bool = True,
    null_text: str = "",
    encoding: str = "utf-8",
) -> int:
    """Write a table to a delimited file.

    Returns:
        The number of data rows written, excluding the header.
    """
    with open(path, "w", newline="", encoding=encoding) as handle:
        handle.write(to_csv_string(table, delimiter, header, null_text))
    return table.num_rows


def to_jsonl_string(table: Table) -> str:
    """Render a table as JSON Lines."""
    lines: List[str] = []
    for row in table.rows():
        lines.append(json.dumps(_encode_row(row, table), separators=(",", ":")))
    return "\n".join(lines) + ("\n" if lines else "")


def write_jsonl(table: Table, path: str, encoding: str = "utf-8") -> int:
    """Write a table as JSON Lines.

    Returns:
        The number of rows written.
    """
    with open(path, "w", encoding=encoding) as handle:
        handle.write(to_jsonl_string(table))
    return table.num_rows


def write_file(
    table: Table, path: str, format_name: Optional[str] = None, **options: Any
) -> int:
    """Write a table, detecting the format from the path when not given.

    Returns:
        The number of rows written.
    """
    resolved = format_name or detect_format(path)
    if resolved == Format.JSONL:
        return write_jsonl(table, path, **options)
    if resolved in (Format.CSV, Format.TSV):
        options.setdefault("delimiter", delimiter_for(resolved))
        return write_csv(table, path, **options)
    raise ValueError(f"unsupported format {resolved!r}")


def _encode_row(row: dict, table: Table) -> dict:
    """Convert one row's values into JSON-compatible types."""
    encoded = {}
    for field in table.schema:
        value = row.get(field.name)
        if is_null(value):
            encoded[field.name] = None
        elif field.dtype == DataType.TIMESTAMP:
            encoded[field.name] = format_value(value)
        else:
            encoded[field.name] = value
    return encoded
