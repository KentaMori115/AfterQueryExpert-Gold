"""The engine facade.

:class:`Engine` is the one class most callers need. It owns a catalog, a
configuration and the two function registries, and it turns SQL text into
results::

    engine = Engine()
    engine.register_csv("trips", "data/trips.csv")
    result = engine.sql("SELECT status, COUNT(*) FROM trips GROUP BY status")

Every method that runs a query goes through the same three steps — parse,
compile, execute — so ``explain`` and ``sql`` can never disagree about what a
statement means.
"""

from __future__ import annotations

from typing import Any, Iterable, List, Mapping, Optional, Sequence

from .config import EngineConfig
from .core.result import QueryResult
from .core.table import Table
from .errors import PlanningError
from .execution.context import ExecutionContext
from .execution.pipeline import execute_plan
from .expr.aggregates import AggregateFunction, AggregateRegistry, default_aggregate_registry
from .expr.functions import FunctionRegistry, ScalarFunction, default_registry
from .expr.resolver import ExpressionResolver, active_registries
from .observability.metrics import MetricsCollector
from .observability.tracing import Tracer
from .plan.logical import LogicalPlan
from .plan.optimizer import Optimizer
from .plan.printer import format_plan
from .sql.compiler import SqlCompiler
from .sql.parser import SelectStatement, parse_select
from .storage.base import DataSource
from .storage.cache import MaterializationCache
from .storage.catalog import Catalog
from .storage.csv_source import CsvSource
from .storage.jsonl_source import JsonLinesSource
from .storage.memory import MemorySource
from .storage.partition import PartitionedSource
from .types.schema import Schema

__all__ = ["Engine"]


class Engine:
    """A query engine bound to one catalog and configuration."""

    def __init__(
        self,
        catalog: Optional[Catalog] = None,
        config: Optional[EngineConfig] = None,
        functions: Optional[FunctionRegistry] = None,
        aggregates: Optional[AggregateRegistry] = None,
    ) -> None:
        self.catalog = catalog if catalog is not None else Catalog()
        self.config = config or EngineConfig()
        self.functions = functions or default_registry()
        self.aggregates = aggregates or default_aggregate_registry()
        self.cache = MaterializationCache(self.config.cache_max_rows)
        self._compiler = SqlCompiler(
            self.catalog, ExpressionResolver(self.functions, self.aggregates)
        )

    # ------------------------------------------------------------------
    # Registration
    # ------------------------------------------------------------------
    def register_source(self, name: str, source: DataSource, replace: bool = False) -> "Engine":
        """Register any data source under ``name``."""
        self.catalog.register(name, source, replace)
        self.cache.invalidate(name)
        return self

    def register_table(self, name: str, table: Table, replace: bool = False) -> "Engine":
        """Register an in-memory table."""
        return self.register_source(name, MemorySource(name, table), replace)

    def register_rows(
        self,
        name: str,
        rows: Iterable[Mapping[str, Any]],
        schema: Optional[Schema] = None,
        replace: bool = False,
    ) -> "Engine":
        """Register dictionaries as an in-memory table."""
        return self.register_source(name, MemorySource.from_dicts(name, rows, schema), replace)

    def register_csv(
        self, name: str, path: str, replace: bool = False, **options: Any
    ) -> "Engine":
        """Register a delimited file."""
        return self.register_source(name, CsvSource(path, name, **options), replace)

    def register_jsonl(
        self, name: str, path: str, replace: bool = False, **options: Any
    ) -> "Engine":
        """Register a JSON Lines file."""
        return self.register_source(name, JsonLinesSource(path, name, **options), replace)

    def register_partitioned(
        self, name: str, root: str, replace: bool = False, **options: Any
    ) -> "Engine":
        """Register a hive-style partitioned directory."""
        return self.register_source(name, PartitionedSource(root, name, **options), replace)

    def drop_table(self, name: str, missing_ok: bool = False) -> bool:
        """Unregister a table.

        Returns:
            True when something was removed.
        """
        self.cache.invalidate(name)
        return self.catalog.drop(name, missing_ok)

    def register_function(self, function: ScalarFunction, replace: bool = False) -> "Engine":
        """Add a scalar function to this engine's registry."""
        self.functions.register(function, replace)
        return self

    def register_aggregate(
        self, function: AggregateFunction, replace: bool = False
    ) -> "Engine":
        """Add an aggregate to this engine's registry."""
        self.aggregates.register(function, replace)
        return self

    # ------------------------------------------------------------------
    # Inspection
    # ------------------------------------------------------------------
    def tables(self) -> List[str]:
        """Registered table names in alphabetical order."""
        return self.catalog.table_names()

    def schema(self, name: str) -> Schema:
        """Return a registered table's schema."""
        return self.catalog.schema_of(name)

    def source(self, name: str) -> DataSource:
        """Return a registered data source."""
        return self.catalog.get(name)

    # ------------------------------------------------------------------
    # Query paths
    # ------------------------------------------------------------------
    def parse(self, sql: str) -> SelectStatement:
        """Parse a statement without resolving it against the catalog.

        Parsing consults this engine's aggregate registry, because whether
        ``foo(x)`` is an aggregate call or a scalar one is a question only the
        registry can answer.
        """
        with self._registries():
            return parse_select(sql)

    def plan(self, sql: str, optimize: Optional[bool] = None) -> LogicalPlan:
        """Compile a statement into a logical plan.

        Args:
            sql: The statement text.
            optimize: Override the configured optimizer setting.
        """
        with self._registries():
            plan = self._compiler.compile(parse_select(sql))
            should_optimize = self.config.optimize if optimize is None else optimize
            return self.optimizer().optimize(plan) if should_optimize else plan

    def sql(self, sql: str, **options: Any) -> QueryResult:
        """Run a statement and return its result."""
        with self._registries():
            plan = self._compiler.compile(parse_select(sql))
            context = self.context(**options)
            optimizer = self.optimizer() if self.config.optimize else _NoopOptimizer()
            return execute_plan(plan, context, optimizer, sql=sql)

    def execute(self, plan: LogicalPlan, **options: Any) -> QueryResult:
        """Run an already built logical plan."""
        with self._registries():
            optimizer = self.optimizer() if self.config.optimize else _NoopOptimizer()
            return execute_plan(plan, self.context(**options), optimizer)

    def explain(self, sql: str, optimized: bool = True, show_schema: bool = False) -> str:
        """Return a printable plan for a statement."""
        with self._registries():
            plan = self.plan(sql, optimize=optimized)
            return format_plan(plan, show_schema=show_schema)

    def table(self, name: str) -> Table:
        """Materialise a registered table, using the cache when enabled."""
        if self.config.cache_enabled:
            cached = self.cache.get(name)
            if cached is not None:
                return cached
        table = self.catalog.get(name).to_table(batch_size=self.config.batch_size)
        if self.config.cache_enabled:
            self.cache.put(name, table)
        return table

    # ------------------------------------------------------------------
    # Plumbing
    # ------------------------------------------------------------------
    def context(self, **overrides: Any) -> ExecutionContext:
        """Build an execution context from the current configuration."""
        batch_size = overrides.pop("batch_size", self.config.batch_size)
        metrics = overrides.pop(
            "metrics", MetricsCollector(self.config.collect_metrics)
        )
        tracer = overrides.pop("tracer", Tracer(self.config.enable_tracing))
        return ExecutionContext(
            catalog=self.catalog,
            functions=self.functions,
            aggregates=self.aggregates,
            batch_size=batch_size,
            metrics=metrics,
            tracer=tracer,
            options=overrides,
        )

    def _registries(self):
        """Publish this engine's registries for the duration of a block.

        Plan nodes resolve their schemas lazily, long after the engine that
        built them has returned, and they carry no registry of their own. This
        makes the engine's registries the ones they find.
        """
        return active_registries(self.functions, self.aggregates)

    def optimizer(self) -> Optimizer:
        """Build an optimizer honouring the configured iteration budget."""
        return Optimizer(max_iterations=self.config.max_optimizer_iterations)

    def with_config(self, **changes: Any) -> "Engine":
        """Return a new engine sharing this catalog but configured differently."""
        return Engine(
            self.catalog, self.config.replace(**changes), self.functions, self.aggregates
        )

    def __repr__(self) -> str:
        return f"Engine({len(self.catalog)} tables, batch_size={self.config.batch_size})"


class _NoopOptimizer(Optimizer):
    """An optimizer that returns plans untouched.

    Used when ``optimize`` is disabled, so the execution path stays identical
    whether or not rewriting is switched on.
    """

    def __init__(self) -> None:
        super().__init__(rules=[])

    def optimize(self, plan: LogicalPlan) -> LogicalPlan:
        return plan
