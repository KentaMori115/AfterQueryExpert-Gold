"""Per-statement execution context.

The context carries everything an operator may need that is not part of its
own configuration: the catalog, the function registry, the session config, and
a place to record counters.  Metrics are advisory -- nothing in the engine
changes behaviour based on them -- so recording them can never affect results.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional

from ..config import DEFAULT_CONFIG, SessionConfig
from ..errors import ExecutionError
from ..functions.registry import FunctionRegistry, default_registry
from ..storage.catalog import Catalog

__all__ = ["ExecutionContext", "ExecutionMetrics"]


@dataclass
class ExecutionMetrics:
    """Counters collected while a statement runs."""

    rows_scanned: int = 0
    rows_emitted: int = 0
    batches_emitted: int = 0
    operators_opened: int = 0
    groups_created: int = 0

    def record_batch(self, rows: int) -> None:
        self.batches_emitted += 1
        self.rows_emitted += rows

    def describe(self) -> str:
        return (
            f"scanned={self.rows_scanned} emitted={self.rows_emitted} "
            f"batches={self.batches_emitted} groups={self.groups_created}"
        )

    def reset(self) -> None:
        self.rows_scanned = 0
        self.rows_emitted = 0
        self.batches_emitted = 0
        self.operators_opened = 0
        self.groups_created = 0


@dataclass
class ExecutionContext:
    """Ambient state shared by every operator in one statement."""

    catalog: Catalog
    registry: FunctionRegistry = field(default_factory=default_registry)
    config: SessionConfig = DEFAULT_CONFIG
    metrics: ExecutionMetrics = field(default_factory=ExecutionMetrics)
    #: Values a correlated subquery borrows from the row of the enclosing
    #: query, in the slot order of its bindings.  Empty outside subqueries.
    outer: tuple[Any, ...] = ()

    @property
    def batch_size(self) -> int:
        return self.config.batch_size

    @property
    def strict_casts(self) -> bool:
        return self.config.strict_casts

    def check_row_budget(self, produced: int) -> None:
        """Raise when a statement exceeds the configured ``max_rows`` ceiling."""

        limit = self.config.max_rows
        if limit and produced > limit:
            raise ExecutionError(
                f"query produced more than {limit} rows",
                hint="raise max_rows or add a LIMIT clause",
            )

    def child(self, *, config: Optional[SessionConfig] = None) -> "ExecutionContext":
        """Derive a context sharing the catalog but using a different config."""

        return ExecutionContext(
            catalog=self.catalog,
            registry=self.registry,
            config=config or self.config,
            metrics=self.metrics,
            outer=self.outer,
        )

    def with_outer(self, values: tuple[Any, ...]) -> "ExecutionContext":
        """Derive the context a subquery runs under for one enclosing row.

        Metrics are shared, so rows a subquery scans count towards the
        statement's totals; only the borrowed values differ.
        """

        return ExecutionContext(
            catalog=self.catalog,
            registry=self.registry,
            config=self.config,
            metrics=self.metrics,
            outer=values,
        )
