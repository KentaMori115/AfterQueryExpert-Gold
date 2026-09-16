"""The object returned from :meth:`veldt.Engine.sql`.

A result wraps the output table together with the plans that produced it and
the metrics gathered while it ran. Most callers only touch the table-shaped
methods; the plan and metrics are there for ``EXPLAIN`` and for tests that care
about which optimizer rules fired.
"""

from __future__ import annotations

from typing import Any, Dict, Iterator, List, Mapping, Optional, Sequence

from ..types.schema import Schema
from .table import Table

__all__ = ["QueryResult"]


class QueryResult:
    """A query's output table plus the metadata describing its execution."""

    __slots__ = ("_table", "_metrics", "_logical_plan", "_optimized_plan", "_sql")

    def __init__(
        self,
        table: Table,
        *,
        metrics: Optional[Mapping[str, Any]] = None,
        logical_plan: Any = None,
        optimized_plan: Any = None,
        sql: Optional[str] = None,
    ) -> None:
        self._table = table
        self._metrics: Dict[str, Any] = dict(metrics or {})
        self._logical_plan = logical_plan
        self._optimized_plan = optimized_plan
        self._sql = sql

    # ------------------------------------------------------------------
    # Table shaped access
    # ------------------------------------------------------------------
    @property
    def table(self) -> Table:
        """The output table."""
        return self._table

    @property
    def schema(self) -> Schema:
        """The output schema."""
        return self._table.schema

    @property
    def column_names(self) -> List[str]:
        """Output column names in order."""
        return self._table.column_names

    @property
    def num_rows(self) -> int:
        """How many rows the query produced."""
        return self._table.num_rows

    def __len__(self) -> int:
        return self._table.num_rows

    def __iter__(self) -> Iterator[Dict[str, Any]]:
        return self._table.rows()

    def __bool__(self) -> bool:
        return bool(self._table)

    def __repr__(self) -> str:
        return f"QueryResult({self.num_rows} rows, columns={self.column_names})"

    def to_dicts(self) -> List[Dict[str, Any]]:
        """Return every row as a dictionary."""
        return self._table.to_dicts()

    def to_rows(self) -> List[tuple]:
        """Return every row as a tuple in schema order."""
        return self._table.to_rows()

    def column(self, name: str) -> List[Any]:
        """Return one output column as a plain list."""
        return self._table.column(name).to_list()

    def first(self) -> Optional[Dict[str, Any]]:
        """Return the first row, or ``None`` when the result is empty."""
        for row in self._table.rows():
            return row
        return None

    def scalar(self) -> Any:
        """Return the single value of a one-row, one-column result.

        Raises:
            ValueError: If the result is not exactly one row and one column.
        """
        if self._table.num_rows != 1 or self._table.num_columns != 1:
            raise ValueError(
                "scalar() requires exactly one row and one column, got "
                f"{self._table.num_rows} rows and {self._table.num_columns} columns"
            )
        return self._table.row(0)[self._table.column_names[0]]

    # ------------------------------------------------------------------
    # Execution metadata
    # ------------------------------------------------------------------
    @property
    def sql(self) -> Optional[str]:
        """The statement text, when the result came from :meth:`Engine.sql`."""
        return self._sql

    @property
    def logical_plan(self) -> Any:
        """The plan as compiled, before optimization."""
        return self._logical_plan

    @property
    def optimized_plan(self) -> Any:
        """The plan actually executed."""
        return self._optimized_plan

    @property
    def metrics(self) -> Dict[str, Any]:
        """Counters and timings gathered during execution."""
        return dict(self._metrics)

    def metric(self, name: str, default: Any = None) -> Any:
        """Return a single metric value."""
        return self._metrics.get(name, default)

    def explain(self, optimized: bool = True) -> str:
        """Return a printable plan tree."""
        from ..plan.printer import format_plan

        plan = self._optimized_plan if optimized else self._logical_plan
        if plan is None:
            return "(no plan recorded)"
        return format_plan(plan)

    def with_metrics(self, metrics: Mapping[str, Any]) -> "QueryResult":
        """Return a copy carrying merged metrics."""
        merged = dict(self._metrics)
        merged.update(metrics)
        return QueryResult(
            self._table,
            metrics=merged,
            logical_plan=self._logical_plan,
            optimized_plan=self._optimized_plan,
            sql=self._sql,
        )
