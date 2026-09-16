"""Delimited text data source.

The source reads the file twice at most: once for a bounded sample used to
infer the schema (skipped entirely when a schema is supplied), and once per
scan. Rows are streamed, so a file much larger than memory can be filtered and
aggregated as long as the result fits.
"""

from __future__ import annotations

import csv
import os
from typing import Any, Iterator, List, Optional, Sequence

from ..core.batch import RecordBatch
from ..core.column import Column
from ..core.table import DEFAULT_BATCH_SIZE
from ..errors import DataSourceError
from ..expr.ast import Expression
from ..plan.stats import Statistics
from ..types.schema import Schema
from .base import DataSource
from .schema_infer import (
    DEFAULT_NULL_VALUES,
    infer_schema,
    normalize_header,
    parse_text_value,
)

__all__ = ["CsvSource", "DEFAULT_SAMPLE_SIZE"]

DEFAULT_SAMPLE_SIZE = 200


class CsvSource(DataSource):
    """Reads rows from a delimited text file.

    Attributes:
        path: Path to the file.
        delimiter: Field separator, ``,`` by default.
        has_header: Whether the first line names the columns. When false the
            columns are named ``column_1``, ``column_2`` and so on.
        sample_size: How many rows to read when inferring the schema.
    """

    def __init__(
        self,
        path: str,
        name: Optional[str] = None,
        schema: Optional[Schema] = None,
        delimiter: str = ",",
        has_header: bool = True,
        quote_char: str = '"',
        null_values: Sequence[str] = tuple(DEFAULT_NULL_VALUES),
        sample_size: int = DEFAULT_SAMPLE_SIZE,
        encoding: str = "utf-8",
    ) -> None:
        if len(delimiter) != 1:
            raise ValueError("delimiter must be a single character")
        if sample_size < 1:
            raise ValueError("sample_size must be at least 1")
        self.path = path
        self.delimiter = delimiter
        self.has_header = has_header
        self.quote_char = quote_char
        self.null_values = tuple(null_values)
        self.sample_size = sample_size
        self.encoding = encoding
        self._name = name or _default_name(path)
        self._schema = schema
        self._row_count: Optional[int] = None

    # ------------------------------------------------------------------
    # DataSource interface
    # ------------------------------------------------------------------
    @property
    def name(self) -> str:
        return self._name

    @property
    def schema(self) -> Schema:
        """The file's schema, inferred on first access when not supplied."""
        if self._schema is None:
            self._schema = self._infer_schema()
        return self._schema

    def scan(
        self,
        projection: Optional[Sequence[str]] = None,
        batch_size: int = DEFAULT_BATCH_SIZE,
        filters: Sequence[Expression] = (),
    ) -> Iterator[RecordBatch]:
        """Stream the file as batches of at most ``batch_size`` rows."""
        if batch_size <= 0:
            raise ValueError("batch_size must be positive")
        target = self.projected_schema(projection)
        source_schema = self.schema
        indices = [source_schema.index_of(field.name) for field in target]
        buffers: List[List[Any]] = [[] for _ in target]
        count = 0
        for row in self._iter_rows():
            for position, (index, field) in enumerate(zip(indices, target)):
                raw = row[index] if index < len(row) else ""
                buffers[position].append(
                    parse_text_value(raw, field.dtype, self.null_values)
                )
            count += 1
            if count >= batch_size:
                yield _build_batch(target, buffers)
                buffers = [[] for _ in target]
                count = 0
        if count:
            yield _build_batch(target, buffers)

    def statistics(self) -> Statistics:
        """Return the row count, counted lazily on first request."""
        if self._row_count is None:
            self._row_count = sum(1 for _ in self._iter_rows())
        return Statistics(self._row_count)

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------
    def _open(self):
        """Open the underlying file.

        Raises:
            DataSourceError: If the file is missing or unreadable.
        """
        try:
            return open(self.path, "r", newline="", encoding=self.encoding)
        except OSError as error:
            raise DataSourceError(f"cannot read {self.path}: {error}") from error

    def _reader(self, handle):
        return csv.reader(handle, delimiter=self.delimiter, quotechar=self.quote_char)

    def _iter_rows(self) -> Iterator[List[str]]:
        """Yield raw data rows, skipping the header when there is one."""
        with self._open() as handle:
            reader = self._reader(handle)
            if self.has_header:
                next(reader, None)
            for row in reader:
                if _is_blank(row):
                    continue
                yield row

    def _infer_schema(self) -> Schema:
        """Read a bounded sample and infer column names and types."""
        with self._open() as handle:
            reader = self._reader(handle)
            first = next(reader, None)
            if first is None:
                raise DataSourceError(f"{self.path} is empty; cannot infer a schema")
            if self.has_header:
                header = normalize_header(first)
                sample: List[List[str]] = []
            else:
                header = [f"column_{index + 1}" for index in range(len(first))]
                sample = [first]
            for row in reader:
                if len(sample) >= self.sample_size:
                    break
                if _is_blank(row):
                    continue
                sample.append(row)
        return infer_schema(header, sample, self.null_values)

    def __repr__(self) -> str:
        return f"CsvSource({self.path!r}, name={self._name!r})"


def _is_blank(row: Sequence[str]) -> bool:
    """True for a line that carries no data.

    A truly empty line reaches the reader as an empty list, while a line of
    separators alone arrives as a single blank field. Neither is a row.
    """
    return not row or (len(row) == 1 and not row[0].strip())


def _build_batch(schema: Schema, buffers: Sequence[List[Any]]) -> RecordBatch:
    """Assemble a batch from per-column value buffers."""
    columns = [
        Column(field.name, field.dtype, buffer) for field, buffer in zip(schema, buffers)
    ]
    return RecordBatch(schema, columns)


def _default_name(path: str) -> str:
    """Derive a table name from a file path."""
    base = os.path.basename(path)
    stem = base.split(".")[0]
    return stem or "csv"
