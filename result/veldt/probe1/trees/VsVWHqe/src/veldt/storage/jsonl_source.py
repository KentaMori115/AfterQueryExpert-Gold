"""JSON Lines data source.

Each line of the file is one JSON object. Unlike CSV, the values already carry
types, so inference only has to reconcile them across records and decide what
to do about keys that some records omit (they become nullable columns).
"""

from __future__ import annotations

import json
import os
from typing import Any, Dict, Iterator, List, Optional, Sequence

from ..core.batch import RecordBatch
from ..core.column import Column
from ..core.table import DEFAULT_BATCH_SIZE
from ..errors import DataSourceError
from ..expr.ast import Expression
from ..plan.stats import Statistics
from ..types.schema import Schema
from .base import DataSource
from .schema_infer import coerce_json_value, infer_schema_from_records

__all__ = ["JsonLinesSource"]

DEFAULT_SAMPLE_SIZE = 200


class JsonLinesSource(DataSource):
    """Reads rows from a newline-delimited JSON file.

    Attributes:
        path: Path to the file.
        skip_invalid: When true, a line that is not valid JSON is skipped
            instead of aborting the scan. Malformed lines are counted and
            reported by :attr:`invalid_line_count`.
    """

    def __init__(
        self,
        path: str,
        name: Optional[str] = None,
        schema: Optional[Schema] = None,
        sample_size: int = DEFAULT_SAMPLE_SIZE,
        skip_invalid: bool = False,
        encoding: str = "utf-8",
    ) -> None:
        if sample_size < 1:
            raise ValueError("sample_size must be at least 1")
        self.path = path
        self.sample_size = sample_size
        self.skip_invalid = skip_invalid
        self.encoding = encoding
        self._name = name or _default_name(path)
        self._schema = schema
        self._invalid_lines = 0
        self._row_count: Optional[int] = None

    # ------------------------------------------------------------------
    # DataSource interface
    # ------------------------------------------------------------------
    @property
    def name(self) -> str:
        return self._name

    @property
    def schema(self) -> Schema:
        """The file's schema, inferred from a bounded sample when not given."""
        if self._schema is None:
            self._schema = self._infer_schema()
        return self._schema

    @property
    def invalid_line_count(self) -> int:
        """How many malformed lines were skipped during the last scan."""
        return self._invalid_lines

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
        buffers: List[List[Any]] = [[] for _ in target]
        count = 0
        self._invalid_lines = 0
        for record in self._iter_records():
            for position, field in enumerate(target):
                buffers[position].append(
                    coerce_json_value(_lookup(record, field.name), field.dtype)
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
            self._row_count = sum(1 for _ in self._iter_records())
        return Statistics(self._row_count)

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------
    def _open(self):
        try:
            return open(self.path, "r", encoding=self.encoding)
        except OSError as error:
            raise DataSourceError(f"cannot read {self.path}: {error}") from error

    def _iter_records(self) -> Iterator[Dict[str, Any]]:
        """Yield decoded objects, one per non-blank line.

        Raises:
            DataSourceError: On a malformed line when ``skip_invalid`` is
                false, or on a line whose JSON value is not an object.
        """
        with self._open() as handle:
            for number, line in enumerate(handle, start=1):
                text = line.strip()
                if not text:
                    continue
                try:
                    record = json.loads(text)
                except json.JSONDecodeError as error:
                    if self.skip_invalid:
                        self._invalid_lines += 1
                        continue
                    raise DataSourceError(
                        f"{self.path}:{number}: invalid JSON ({error.msg})"
                    ) from error
                if not isinstance(record, dict):
                    if self.skip_invalid:
                        self._invalid_lines += 1
                        continue
                    raise DataSourceError(
                        f"{self.path}:{number}: expected a JSON object, got "
                        f"{type(record).__name__}"
                    )
                yield record

    def _infer_schema(self) -> Schema:
        sample: List[Dict[str, Any]] = []
        for record in self._iter_records():
            sample.append(record)
            if len(sample) >= self.sample_size:
                break
        if not sample:
            raise DataSourceError(f"{self.path} has no records; cannot infer a schema")
        return infer_schema_from_records(sample)

    def __repr__(self) -> str:
        return f"JsonLinesSource({self.path!r}, name={self._name!r})"


def _lookup(record: Dict[str, Any], name: str) -> Any:
    """Fetch a key from a record, falling back to a case-insensitive match."""
    if name in record:
        return record[name]
    lowered = name.lower()
    for key, value in record.items():
        if key.lower() == lowered:
            return value
    return None


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
    return stem or "jsonl"
