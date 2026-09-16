"""Execution context.

The context is the single object every operator needs: the function registries
to evaluate expressions with, the batch size to emit, and the metrics collector
and tracer to report into. Operators hold no configuration of their own, which
means the same operator tree can be run twice with different batch sizes.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from ..core.table import DEFAULT_BATCH_SIZE
from ..errors import ConfigurationError
from ..expr.aggregates import AggregateRegistry, default_aggregate_registry
from ..expr.evaluator import Evaluator
from ..expr.functions import FunctionRegistry, default_registry
from ..observability.metrics import MetricsCollector
from ..observability.tracing import Tracer
from ..storage.catalog import Catalog

__all__ = ["ExecutionContext"]


class ExecutionContext:
    """Everything an operator needs in order to run.

    Attributes:
        catalog: Where table names resolve.
        functions: Scalar function registry.
        aggregates: Aggregate function registry.
        batch_size: Maximum rows an operator emits per batch.
        metrics: Counters and timers for this execution.
        tracer: Span recorder for this execution.
    """

    def __init__(
        self,
        catalog: Optional[Catalog] = None,
        functions: Optional[FunctionRegistry] = None,
        aggregates: Optional[AggregateRegistry] = None,
        batch_size: int = DEFAULT_BATCH_SIZE,
        metrics: Optional[MetricsCollector] = None,
        tracer: Optional[Tracer] = None,
        options: Optional[Dict[str, Any]] = None,
    ) -> None:
        if batch_size <= 0:
            raise ConfigurationError("batch_size must be positive")
        self.catalog = catalog if catalog is not None else Catalog()
        self.functions = functions or default_registry()
        self.aggregates = aggregates or default_aggregate_registry()
        self.batch_size = batch_size
        self.metrics = metrics if metrics is not None else MetricsCollector()
        self.tracer = tracer if tracer is not None else Tracer(enabled=False)
        self.options: Dict[str, Any] = dict(options or {})
        self._evaluator = Evaluator(self.functions, self.aggregates)

    @property
    def evaluator(self) -> Evaluator:
        """The evaluator bound to this context's registries."""
        return self._evaluator

    def option(self, name: str, default: Any = None) -> Any:
        """Read one free-form execution option."""
        return self.options.get(name, default)

    def with_batch_size(self, batch_size: int) -> "ExecutionContext":
        """Return a copy that emits differently sized batches.

        The metrics collector and tracer are shared, so a nested execution
        still reports into the same place.
        """
        return ExecutionContext(
            catalog=self.catalog,
            functions=self.functions,
            aggregates=self.aggregates,
            batch_size=batch_size,
            metrics=self.metrics,
            tracer=self.tracer,
            options=self.options,
        )

    def child(self) -> "ExecutionContext":
        """Return a context with a fresh metrics collector.

        Used when a sub-plan's cost should be measured separately before being
        merged back into the parent.
        """
        return ExecutionContext(
            catalog=self.catalog,
            functions=self.functions,
            aggregates=self.aggregates,
            batch_size=self.batch_size,
            metrics=MetricsCollector(self.metrics.enabled),
            tracer=self.tracer,
            options=self.options,
        )

    def __repr__(self) -> str:
        return (
            f"ExecutionContext(tables={len(self.catalog)}, "
            f"batch_size={self.batch_size})"
        )
