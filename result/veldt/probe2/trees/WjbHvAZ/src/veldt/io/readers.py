"""Convenience readers that return tables directly.

The data sources in :mod:`veldt.storage` stream batches and are what the engine
uses. These helpers wrap them for the common case of "read this file into
memory and hand me a table".
"""

from __future__ import annotations

from typing import Any, Iterable, Mapping, Optional, Sequence

from ..core.table import DEFAULT_BATCH_SIZE, Table
from ..storage.base import DataSource
from ..storage.csv_source import CsvSource
from ..storage.jsonl_source import JsonLinesSource
from ..types.schema import Schema
from .formats import Format, delimiter_for, detect_format

__all__ = ["read_csv", "read_jsonl", "read_file", "source_for", "read_rows"]


def source_for(
    path: str,
    name: Optional[str] = None,
    schema: Optional[Schema] = None,
    format_name: Optional[str] = None,
    **options: Any,
) -> DataSource:
    """Build the right data source for a path.

    Args:
        path: File to read.
        name: Table name; defaults to the file stem.
        schema: Explicit schema, skipping inference.
        format_name: Override the format instead of detecting it.
        **options: Passed through to the underlying source.
    """
    resolved = format_name or detect_format(path)
    if resolved == Format.JSONL:
        return JsonLinesSource(path, name, schema, **options)
    if resolved in (Format.CSV, Format.TSV):
        options.setdefault("delimiter", delimiter_for(resolved))
        return CsvSource(path, name, schema, **options)
    raise ValueError(f"unsupported format {resolved!r}")


def read_csv(
    path: str,
    schema: Optional[Schema] = None,
    delimiter: str = ",",
    has_header: bool = True,
    batch_size: int = DEFAULT_BATCH_SIZE,
    **options: Any,
) -> Table:
    """Read a delimited file into a table."""
    source = CsvSource(
        path, schema=schema, delimiter=delimiter, has_header=has_header, **options
    )
    return source.to_table(batch_size=batch_size)


def read_jsonl(
    path: str,
    schema: Optional[Schema] = None,
    skip_invalid: bool = False,
    batch_size: int = DEFAULT_BATCH_SIZE,
    **options: Any,
) -> Table:
    """Read a JSON Lines file into a table."""
    source = JsonLinesSource(path, schema=schema, skip_invalid=skip_invalid, **options)
    return source.to_table(batch_size=batch_size)


def read_file(
    path: str,
    schema: Optional[Schema] = None,
    format_name: Optional[str] = None,
    batch_size: int = DEFAULT_BATCH_SIZE,
    **options: Any,
) -> Table:
    """Read any supported file into a table, detecting the format."""
    return source_for(path, schema=schema, format_name=format_name, **options).to_table(
        batch_size=batch_size
    )


def read_rows(rows: Iterable[Mapping[str, Any]], schema: Optional[Schema] = None) -> Table:
    """Build a table from dictionaries already in memory."""
    return Table.from_dicts(rows, schema)
