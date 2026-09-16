"""Hive-style partitioned data sources.

A partitioned dataset is a directory tree whose directory names encode column
values::

    events/
      region=eu/day=2026-05-01/part-0.csv
      region=eu/day=2026-05-02/part-0.csv
      region=us/day=2026-05-01/part-0.csv

The partition keys become real columns in the schema, materialised from the
directory names rather than read from the files. Because those values are known
before any file is opened, an equality or ``IN`` predicate over a partition key
can eliminate whole files — which is what
:meth:`PartitionedSource.supports_filter_pushdown` advertises to the optimizer.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Callable, Dict, Iterator, List, Optional, Sequence, Tuple

from ..core.batch import RecordBatch
from ..core.column import Column
from ..core.table import DEFAULT_BATCH_SIZE
from ..errors import DataSourceError
from ..expr.ast import BinaryOp, ColumnRef, Expression, InList, Literal, collect_columns
from ..plan.stats import Statistics
from ..types.dtypes import DataType
from ..types.schema import Field, Schema
from ..types.casting import try_cast_value
from ..types.value import values_equal
from .base import DataSource
from .csv_source import CsvSource
from .schema_infer import infer_column_type, parse_text_value

__all__ = ["Partition", "PartitionedSource", "discover_partitions"]


@dataclass(frozen=True)
class Partition:
    """One leaf of a partitioned dataset."""

    path: str
    values: Tuple[Tuple[str, Any], ...]

    def value_of(self, key: str) -> Any:
        """Return this partition's value for ``key``, or ``None``."""
        lowered = key.lower()
        for name, value in self.values:
            if name.lower() == lowered:
                return value
        return None

    def describe(self) -> str:
        """Render the partition as ``key=value/key=value``."""
        return "/".join(f"{name}={value}" for name, value in self.values)


def discover_partitions(root: str, extensions: Sequence[str] = (".csv",)) -> List[Partition]:
    """Walk ``root`` and return every data file with its partition values.

    Files that sit outside any ``key=value`` directory still produce a
    partition, just one with no values.

    Raises:
        DataSourceError: If ``root`` does not exist or is not a directory.
    """
    if not os.path.isdir(root):
        raise DataSourceError(f"{root} is not a directory")
    suffixes = tuple(item.lower() for item in extensions)
    found: List[Partition] = []
    for directory, _, files in os.walk(root):
        relative = os.path.relpath(directory, root)
        values = _parse_partition_path(relative)
        for filename in sorted(files):
            if filename.startswith("."):
                continue
            if suffixes and not filename.lower().endswith(suffixes):
                continue
            found.append(Partition(os.path.join(directory, filename), values))
    found.sort(key=lambda item: item.path)
    return found


def _parse_partition_path(relative: str) -> Tuple[Tuple[str, Any], ...]:
    """Extract ``key=value`` pairs from a relative directory path."""
    if relative in (".", ""):
        return ()
    pairs: List[Tuple[str, Any]] = []
    for segment in relative.split(os.sep):
        if "=" not in segment:
            continue
        key, _, raw = segment.partition("=")
        if key:
            pairs.append((key, raw))
    return tuple(pairs)


class PartitionedSource(DataSource):
    """A data source spanning many files that share a schema.

    Attributes:
        root: The directory containing the partitioned files.
        partition_columns: The keys discovered in the directory names, in the
            order they appear in the path.
    """

    def __init__(
        self,
        root: str,
        name: Optional[str] = None,
        schema: Optional[Schema] = None,
        extensions: Sequence[str] = (".csv",),
        file_factory: Optional[Callable[[str], DataSource]] = None,
    ) -> None:
        self.root = root
        self._name = name or os.path.basename(os.path.normpath(root)) or "partitioned"
        self._extensions = tuple(extensions)
        self._file_factory = file_factory or (lambda path: CsvSource(path))
        self._partitions = discover_partitions(root, self._extensions)
        if not self._partitions:
            raise DataSourceError(f"{root} contains no data files")
        self._partition_columns = [name for name, _ in self._partitions[0].values]
        self._validate_partitions()
        self._schema = schema
        self._file_schema: Optional[Schema] = None

    # ------------------------------------------------------------------
    # DataSource interface
    # ------------------------------------------------------------------
    @property
    def name(self) -> str:
        return self._name

    @property
    def partitions(self) -> List[Partition]:
        """Every discovered partition, sorted by path."""
        return list(self._partitions)

    @property
    def partition_columns(self) -> List[str]:
        """The names of the partition key columns."""
        return list(self._partition_columns)

    @property
    def schema(self) -> Schema:
        """File columns followed by partition columns."""
        if self._schema is None:
            self._schema = self._build_schema()
        return self._schema

    def scan(
        self,
        projection: Optional[Sequence[str]] = None,
        batch_size: int = DEFAULT_BATCH_SIZE,
        filters: Sequence[Expression] = (),
    ) -> Iterator[RecordBatch]:
        """Scan every partition that survives partition pruning."""
        target = self.projected_schema(projection)
        file_schema = self._file_columns()
        wanted_file_columns = [
            field.name for field in target if file_schema.has(field.name)
        ]
        for partition in self.prune(filters):
            source = self._file_factory(partition.path)
            for batch in source.scan(wanted_file_columns or None, batch_size):
                yield self._attach_partition_columns(batch, partition, target)

    def supports_filter_pushdown(self, predicate: Expression) -> bool:
        """Accept predicates that only reference partition columns.

        Only equality and ``IN`` against literals can prune, so those are the
        only shapes accepted; anything else is left to the filter operator.
        """
        references = collect_columns(predicate)
        if not references:
            return False
        partition_names = {name.lower() for name in self._partition_columns}
        if any(item.name.lower() not in partition_names for item in references):
            return False
        if isinstance(predicate, BinaryOp) and predicate.operator == "=":
            return _is_column_literal_pair(predicate)
        if isinstance(predicate, InList) and not predicate.negated:
            return isinstance(predicate.child, ColumnRef) and all(
                isinstance(option, Literal) for option in predicate.options
            )
        return False

    def prune(self, filters: Sequence[Expression] = ()) -> List[Partition]:
        """Return the partitions that can still contain matching rows."""
        kept = self._partitions
        for predicate in filters:
            kept = [item for item in kept if self._partition_matches(item, predicate)]
        return kept

    def statistics(self) -> Statistics:
        """Sum the row counts of every partition."""
        total = 0
        for partition in self._partitions:
            counted = self._file_factory(partition.path).statistics()
            if counted.num_rows is None:
                return Statistics(None)
            total += counted.num_rows
        return Statistics(total)

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------
    def _validate_partitions(self) -> None:
        """Reject a tree whose partitions disagree about their key names.

        Raises:
            DataSourceError: If the partition keys are inconsistent.
        """
        expected = tuple(self._partition_columns)
        for partition in self._partitions:
            actual = tuple(name for name, _ in partition.values)
            if actual != expected:
                raise DataSourceError(
                    f"{self.root}: inconsistent partition keys, expected "
                    f"{list(expected)} but {partition.path} has {list(actual)}"
                )

    def _file_columns(self) -> Schema:
        """Return the schema shared by the underlying files."""
        if self._file_schema is None:
            self._file_schema = self._file_factory(self._partitions[0].path).schema
        return self._file_schema

    def _build_schema(self) -> Schema:
        """Combine file columns with inferred partition column types."""
        fields: List[Field] = list(self._file_columns())
        for index, key in enumerate(self._partition_columns):
            samples = [str(item.values[index][1]) for item in self._partitions]
            dtype = infer_column_type(samples)
            fields.append(Field(key, dtype, False, {"partition": "true"}))
        return Schema(fields)

    def _partition_value(self, partition: Partition, name: str) -> Any:
        """Return a partition's value for a column, parsed to its type."""
        raw = partition.value_of(name)
        if raw is None:
            return None
        return parse_text_value(str(raw), self.schema.dtype_of(name))

    def _partition_matches(self, partition: Partition, predicate: Expression) -> bool:
        """Evaluate a pushed-down predicate against a partition's values.

        Partition values are parsed to the column's type, so the literal is
        converted the same way before comparing. Without that, pruning a
        timestamp partition against ``'2026-05-01'`` would compare a datetime
        with a string and quietly discard every partition.
        """
        if isinstance(predicate, BinaryOp) and predicate.operator == "=":
            column, literal = _column_literal_pair(predicate)
            if column is None or literal is None:
                return True
            return self._value_matches(partition, column.name, literal.value)
        if isinstance(predicate, InList) and isinstance(predicate.child, ColumnRef):
            name = predicate.child.name
            matched = any(
                self._value_matches(partition, name, option.value)
                for option in predicate.options
                if isinstance(option, Literal)
            )
            return matched != predicate.negated
        return True

    def _value_matches(self, partition: Partition, name: str, wanted: Any) -> bool:
        """Compare one partition value against a literal from a predicate."""
        if not self.schema.has(name):
            return True
        value = self._partition_value(partition, name)
        target = try_cast_value(wanted, self.schema.dtype_of(name))
        return values_equal(value, target) is True

    def _attach_partition_columns(
        self, batch: RecordBatch, partition: Partition, target: Schema
    ) -> RecordBatch:
        """Add the partition key columns to a batch read from one file."""
        columns: List[Column] = []
        for field in target:
            if batch.has_column(field.name):
                columns.append(batch.column(field.name))
            else:
                value = self._partition_value(partition, field.name)
                columns.append(Column(field.name, field.dtype, [value] * batch.num_rows))
        return RecordBatch(target, columns)

    def __repr__(self) -> str:
        return (
            f"PartitionedSource({self.root!r}, partitions={len(self._partitions)}, "
            f"keys={self._partition_columns})"
        )


def _column_literal_pair(
    predicate: BinaryOp,
) -> Tuple[Optional[ColumnRef], Optional[Literal]]:
    """Return the column and literal of a ``col = literal`` comparison."""
    if isinstance(predicate.left, ColumnRef) and isinstance(predicate.right, Literal):
        return predicate.left, predicate.right
    if isinstance(predicate.right, ColumnRef) and isinstance(predicate.left, Literal):
        return predicate.right, predicate.left
    return None, None


def _is_column_literal_pair(predicate: BinaryOp) -> bool:
    """True when a comparison has a column on one side and a literal on the other."""
    column, literal = _column_literal_pair(predicate)
    return column is not None and literal is not None
