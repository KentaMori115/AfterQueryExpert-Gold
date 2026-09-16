"""Delimited-text data source.

The reader is deliberately strict about row width: a short or long row is a
data error, not something to silently pad, because a silently padded row shows
up much later as a confusing NULL.
"""

from __future__ import annotations

import csv
from pathlib import Path
from typing import Any, Iterator, Optional, Sequence

from ...errors import StorageError
from ...types.schema import Field, Schema
from ...types.values import cast_value, infer_column_type
from ..schema_infer import infer_schema_from_rows, parse_scalar
from .base import DataSource, ProjectionPushdown

__all__ = ["CsvSource"]

_SAMPLE_ROWS = 200


class CsvSource(DataSource, ProjectionPushdown):
    """Reads rows from a delimited text file."""

    def __init__(
        self,
        path: str | Path,
        *,
        schema: Optional[Schema] = None,
        delimiter: str = ",",
        has_header: bool = True,
        null_token: str = "",
        encoding: str = "utf-8",
        sample_rows: int = _SAMPLE_ROWS,
    ) -> None:
        self._path = Path(path)
        self._delimiter = delimiter
        self._has_header = has_header
        self._null_token = null_token
        self._encoding = encoding
        self._sample_rows = sample_rows
        self._schema = schema
        self._row_count: Optional[int] = None

    @property
    def name(self) -> str:
        return self._path.name

    @property
    def path(self) -> Path:
        return self._path

    @property
    def schema(self) -> Schema:
        if self._schema is None:
            self._schema = self._infer_schema()
        return self._schema

    def row_count(self) -> Optional[int]:
        return self._row_count

    # -- reading ---------------------------------------------------------

    def _open_reader(self):
        try:
            handle = self._path.open("r", encoding=self._encoding, newline="")
        except OSError as exc:
            raise StorageError(f"cannot read {self._path}: {exc}") from exc
        return handle, csv.reader(handle, delimiter=self._delimiter)

    def _infer_schema(self) -> Schema:
        handle, reader = self._open_reader()
        with handle:
            try:
                header = next(reader)
            except StopIteration:
                raise StorageError(f"{self._path} is empty") from None
            if self._has_header:
                names = [name.strip() for name in header]
                sample: list[list[str]] = []
            else:
                names = [f"column{index + 1}" for index in range(len(header))]
                sample = [header]
            for row in reader:
                if len(sample) >= self._sample_rows:
                    break
                sample.append(row)
        if not names:
            raise StorageError(f"{self._path} has no columns")
        parsed = [
            [self._decode(cell) for cell in row]
            for row in sample
            if len(row) == len(names)
        ]
        return infer_schema_from_rows(names, parsed)

    def _decode(self, cell: str) -> Any:
        if cell == self._null_token:
            return None
        return parse_scalar(cell)

    def scan(self, projection: Optional[Sequence[int]] = None) -> Iterator[list[Any]]:
        schema = self.schema
        indices = self.resolve_projection(schema, projection)
        types = [field.dtype for field in schema]
        width = len(schema)
        handle, reader = self._open_reader()
        count = 0
        with handle:
            if self._has_header:
                try:
                    next(reader)
                except StopIteration:
                    self._row_count = 0
                    return
            for line_number, raw in enumerate(reader, start=2 if self._has_header else 1):
                if not raw:
                    continue
                if len(raw) != width:
                    raise StorageError(
                        f"{self._path}:{line_number}: expected {width} fields, "
                        f"found {len(raw)}"
                    )
                row = [
                    cast_value(self._decode(cell), types[index])
                    for index, cell in enumerate(raw)
                ]
                count += 1
                yield row if indices is None else [row[i] for i in indices]
        self._row_count = count

    def with_schema(self, schema: Schema) -> "CsvSource":
        """Return a copy that uses an explicit schema instead of inference."""

        return CsvSource(
            self._path,
            schema=schema,
            delimiter=self._delimiter,
            has_header=self._has_header,
            null_token=self._null_token,
            encoding=self._encoding,
            sample_rows=self._sample_rows,
        )

    @staticmethod
    def infer_field(name: str, values: Sequence[Any]) -> Field:
        """Helper exposed for tests and for the ``load`` command."""

        return Field(name=name, dtype=infer_column_type(values))
