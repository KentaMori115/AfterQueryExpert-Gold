"""The public entry point of the engine.

A :class:`Session` owns a catalog, a function registry and a configuration,
and turns SQL text into results:

>>> session = Session()
>>> session.register_rows("t", Schema.of(("n", INTEGER)), [[1], [2]])
>>> session.sql("SELECT SUM(n) AS total FROM t").scalar()
3

Everything else in the package is reachable from here, but nothing else needs
to be imported to run a query.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Iterable, Mapping, Optional, Sequence

from .analyze.binder import Binder
from .config import DEFAULT_CONFIG, SessionConfig
from .errors import SlateQLError
from .execution.context import ExecutionContext
from .execution.operators.values import ValuesOperator
from .execution.pipeline import collect
from .execution.planner import PhysicalPlanner, describe_operator_tree
from .functions.registry import FunctionRegistry, default_registry
from .optimize.pipeline import OptimizationTrace, Optimizer
from .plan.logical import LogicalPlan
from .plan.printer import format_plan
from .result import QueryResult
from .sql import ast_nodes as A
from .sql.parser import parse
from .storage.catalog import Catalog
from .storage.sources.base import DataSource
from .storage.sources.csv_source import CsvSource
from .storage.sources.jsonl_source import JsonlSource
from .storage.table import Index, Table
from .types.datatypes import INTEGER, STRING
from .types.schema import Field, Schema

__all__ = ["Session"]

_TABLES_SCHEMA = Schema.of(("table_name", STRING), ("columns", INTEGER))
_COLUMNS_SCHEMA = Schema.of(
    ("column_name", STRING), ("data_type", STRING), ("nullable", STRING)
)
_INDEXES_SCHEMA = Schema.of(
    ("table_name", STRING),
    ("column_name", STRING),
    ("kind", STRING),
    ("entries", INTEGER),
    ("distinct_keys", INTEGER),
    ("has_nulls", STRING),
)


class Session:
    """Owns a catalog and executes statements against it."""

    def __init__(
        self,
        *,
        config: Optional[SessionConfig] = None,
        catalog: Optional[Catalog] = None,
        registry: Optional[FunctionRegistry] = None,
    ) -> None:
        self.config = config or DEFAULT_CONFIG
        self.catalog = catalog if catalog is not None else Catalog()
        self.registry = registry or default_registry()

    # -- configuration ---------------------------------------------------

    def configure(self, **options: Any) -> "Session":
        """Replace the session configuration in place and return self."""

        self.config = self.config.replace(**options)
        return self

    # -- registration ----------------------------------------------------

    def register(self, name: str, source: DataSource) -> Table:
        """Register any data source under ``name``."""

        return self.catalog.register(name, source)

    def register_rows(
        self, name: str, schema: Schema, rows: Iterable[Sequence[Any]]
    ) -> Table:
        """Register an in-memory table from an explicit schema and rows."""

        return self.catalog.register_rows(name, schema, rows)

    def register_dicts(
        self,
        name: str,
        records: Iterable[Mapping[str, Any]],
        *,
        schema: Optional[Schema] = None,
    ) -> Table:
        """Register an in-memory table built from dictionaries."""

        return self.catalog.register_dicts(name, records, schema=schema)

    def register_csv(
        self,
        name: str,
        path: str | Path,
        *,
        delimiter: str = ",",
        has_header: bool = True,
        null_token: str = "",
        schema: Optional[Schema] = None,
    ) -> Table:
        """Register a delimited text file as a table."""

        source = CsvSource(
            path,
            delimiter=delimiter,
            has_header=has_header,
            null_token=null_token,
            schema=schema,
        )
        return self.catalog.register(name, source)

    def register_jsonl(
        self,
        name: str,
        path: str | Path,
        *,
        schema: Optional[Schema] = None,
    ) -> Table:
        """Register a newline-delimited JSON file as a table."""

        return self.catalog.register(name, JsonlSource(path, schema=schema))

    def drop(self, name: str) -> bool:
        return self.catalog.drop(name)

    def tables(self) -> list[str]:
        return self.catalog.table_names()

    def schema_of(self, name: str) -> Schema:
        return self.catalog.schema_of(name)

    def analyze(self, name: Optional[str] = None) -> dict[str, int]:
        """Compute statistics for one table or for all of them."""

        return self.catalog.analyze(name)

    # -- indexes ---------------------------------------------------------

    def create_index(self, table: str, column: str, kind: str = "hash") -> Index:
        """Index ``column`` of ``table``, replacing any index already on it.

        ``kind`` picks the shape: ``"hash"`` for point lookups, ``"sorted"``
        for ranges and ordered reads.  Nothing about a query's answer changes;
        only the work behind it does.
        """

        return self.catalog.get(table).create_index(column, kind=kind)

    def drop_index(self, table: str, column: str) -> bool:
        """Remove the index on a column, reporting whether one was there."""

        return self.catalog.get(table).drop_index(column)

    # -- planning --------------------------------------------------------

    def logical_plan(self, statement: str) -> LogicalPlan:
        """Bind ``statement`` without optimizing it."""

        parsed = parse(statement)
        return self._bind(parsed)

    def plan(self, statement: str) -> LogicalPlan:
        """Bind and optimize ``statement``."""

        return self._optimize(self.logical_plan(statement))

    def explain(self, statement: str, *, verbose: bool = False) -> str:
        """Render the plan for ``statement`` as an indented tree."""

        parsed = parse(statement)
        if isinstance(parsed, A.ExplainStatement):
            verbose = verbose or parsed.verbose
            parsed = parsed.statement
        if isinstance(parsed, A.ShowStatement):
            return "Metadata"
        logical = self._bind(parsed)
        trace = OptimizationTrace()
        optimized = self._optimize(logical, trace=trace)
        lines = [format_plan(optimized)]
        if verbose:
            lines.append("")
            lines.append("Unoptimized:")
            lines.append(format_plan(logical))
            lines.append("")
            lines.append("Optimizer: " + trace.describe())
            lines.append("")
            lines.append("Physical:")
            operator = PhysicalPlanner(self.catalog).build(optimized)
            lines.extend(describe_operator_tree(operator))
        return "\n".join(lines)

    # -- execution -------------------------------------------------------

    def sql(self, statement: str) -> QueryResult:
        """Parse, bind, optimize, and run ``statement``."""

        parsed = parse(statement)
        if isinstance(parsed, A.ExplainStatement):
            return self._explain_result(parsed)
        if isinstance(parsed, A.ShowStatement):
            return self._show_result(parsed)
        plan = self._optimize(self._bind(parsed))
        operator = PhysicalPlanner(self.catalog).build(plan)
        context = ExecutionContext(
            catalog=self.catalog, registry=self.registry, config=self.config
        )
        return collect(operator, context, statement=statement)

    def query(self, statement: str) -> list[dict[str, Any]]:
        """Run ``statement`` and return the rows as dictionaries."""

        return self.sql(statement).to_dicts()

    def scalar(self, statement: str) -> Any:
        """Run ``statement`` and return its single value."""

        return self.sql(statement).scalar()

    # -- internals -------------------------------------------------------

    def _bind(self, statement: A.Statement) -> LogicalPlan:
        binder = Binder(self.catalog, self.registry, self.config)
        return binder.bind(statement)

    def _optimize(
        self, plan: LogicalPlan, *, trace: Optional[OptimizationTrace] = None
    ) -> LogicalPlan:
        optimizer = Optimizer(
            self.catalog, config=self.config, registry=self.registry
        )
        return optimizer.optimize(plan, trace=trace)

    def _explain_result(self, statement: A.ExplainStatement) -> QueryResult:
        text = self.explain(
            _render(statement.statement), verbose=statement.verbose
        )
        schema = Schema([Field(name="plan", dtype=STRING)])
        return QueryResult(
            schema=schema,
            rows=[[line] for line in text.splitlines()],
            statement="EXPLAIN",
        )

    def _show_result(self, statement: A.ShowStatement) -> QueryResult:
        if statement.target == "tables":
            rows = [
                [name, len(self.catalog.schema_of(name))]
                for name in self.catalog.table_names()
            ]
            operator = ValuesOperator(_TABLES_SCHEMA, rows)
        elif statement.target == "indexes":
            rows = [
                [
                    table_name,
                    stats.column,
                    stats.kind,
                    stats.entries,
                    stats.distinct_keys,
                    "YES" if stats.has_nulls else "NO",
                ]
                for table_name, stats in self.catalog.index_stats(statement.table)
            ]
            operator = ValuesOperator(_INDEXES_SCHEMA, rows)
        elif statement.target == "columns":
            if not statement.table:
                raise SlateQLError("SHOW COLUMNS requires a table name")
            schema = self.catalog.schema_of(statement.table)
            rows = [
                [field.name, field.dtype.name, "YES" if field.dtype.nullable else "NO"]
                for field in schema
            ]
            operator = ValuesOperator(_COLUMNS_SCHEMA, rows)
        else:  # pragma: no cover - the parser rejects other targets
            raise SlateQLError(f"unsupported SHOW target {statement.target!r}")
        context = ExecutionContext(
            catalog=self.catalog, registry=self.registry, config=self.config
        )
        return collect(operator, context, statement="SHOW")


def _render(statement: A.Statement) -> str:
    from .sql.unparser import unparse

    return unparse(statement)
