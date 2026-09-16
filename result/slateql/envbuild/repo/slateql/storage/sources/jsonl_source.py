"""Newline-delimited JSON data source."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterator, Optional, Sequence

from ...errors import StorageError
from ...types.schema import Field, Schema
from ...types.values import cast_value
from ..schema_infer import coerce_json_scalar, infer_field_type
from .base import DataSource, ProjectionPushdown

__all__ = ["JsonlSource"]

_SAMPLE_ROWS = 200


class JsonlSource(DataSource, ProjectionPushdown):
    """Reads one JSON object per line.

    Missing keys become NULL rather than an error, because sparse records are
    the norm in JSONL exports.  Nested objects and arrays are rejected: the
    engine has no nested types.
    """

    def __init__(
        self,
        path: str | Path,
        *,
        schema: Optional[Schema] = None,
        encoding: str = "utf-8",
        sample_rows: int = _SAMPLE_ROWS,
        skip_blank_lines: bool = True,
    ) -> None:
        self._path = Path(path)
        self._encoding = encoding
        self._sample_rows = sample_rows
        self._skip_blank_lines = skip_blank_lines
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

    def _iter_records(self) -> Iterator[tuple[int, dict[str, Any]]]:
        try:
            handle = self._path.open("r", encoding=self._encoding)
        except OSError as exc:
            raise StorageError(f"cannot read {self._path}: {exc}") from exc
        with handle:
            for line_number, line in enumerate(handle, start=1):
                text = line.strip()
                if not text:
                    if self._skip_blank_lines:
                        continue
                    raise StorageError(f"{self._path}:{line_number}: blank line")
                try:
                    record = json.loads(text)
                except json.JSONDecodeError as exc:
                    raise StorageError(
                        f"{self._path}:{line_number}: invalid JSON ({exc.msg})"
                    ) from exc
                if not isinstance(record, dict):
                    raise StorageError(
                        f"{self._path}:{line_number}: expected a JSON object, "
                        f"found {type(record).__name__}"
                    )
                yield line_number, record

    def _infer_schema(self) -> Schema:
        names: list[str] = []
        sample: list[dict[str, Any]] = []
        for line_number, record in self._iter_records():
            for key, value in record.items():
                if isinstance(value, (dict, list)):
                    raise StorageError(
                        f"{self._path}:{line_number}: column {key!r} holds a "
                        f"nested {type(value).__name__}, which is not supported",
                        hint="flatten the record before loading it",
                    )
                if key not in names:
                    names.append(key)
            sample.append(record)
            if len(sample) >= self._sample_rows:
                break
        if not names:
            raise StorageError(f"{self._path} contains no records")
        return Schema(
            Field(
                name=name,
                dtype=infer_field_type(
                    [coerce_json_scalar(record.get(name)) for record in sample]
                ),
            )
            for name in names
        )

    def scan(self, projection: Optional[Sequence[int]] = None) -> Iterator[list[Any]]:
        schema = self.schema
        indices = self.resolve_projection(schema, projection)
        fields = list(schema)
        count = 0
        for line_number, record in self._iter_records():
            row: list[Any] = []
            for field in fields:
                value = record.get(field.name)
                if isinstance(value, (dict, list)):
                    raise StorageError(
                        f"{self._path}:{line_number}: column {field.name!r} holds a "
                        f"nested {type(value).__name__}, which is not supported"
                    )
                row.append(cast_value(value, field.dtype))
            count += 1
            yield row if indices is None else [row[i] for i in indices]
        self._row_count = count

    def with_schema(self, schema: Schema) -> "JsonlSource":
        return JsonlSource(
            self._path,
            schema=schema,
            encoding=self._encoding,
            sample_rows=self._sample_rows,
            skip_blank_lines=self._skip_blank_lines,
        )
