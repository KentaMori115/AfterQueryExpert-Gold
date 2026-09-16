"""veldt: a small analytical query engine in pure Python.

The public surface is deliberately narrow. Most programs need only:

    from veldt import Engine

    engine = Engine()
    engine.register_csv("trips", "trips.csv")
    result = engine.sql("SELECT COUNT(*) FROM trips")

The remaining names exported here are the types those calls hand back, plus the
error classes worth catching.
"""

from __future__ import annotations

from .config import EngineConfig
from .core.batch import RecordBatch
from .core.column import Column
from .core.result import QueryResult
from .core.table import Table
from .engine import Engine
from .errors import (
    CastError,
    CatalogError,
    ColumnNotFoundError,
    ConfigurationError,
    DataSourceError,
    DuplicateColumnError,
    ExecutionError,
    FunctionNotFoundError,
    ParseError,
    PlanningError,
    SchemaError,
    TableAlreadyExistsError,
    TableNotFoundError,
    TypeMismatchError,
    UnsupportedFeatureError,
    VeldtError,
)
from .io.readers import read_csv, read_file, read_jsonl
from .io.writers import write_csv, write_file, write_jsonl
from .storage.catalog import Catalog
from .types.dtypes import DataType
from .types.schema import Field, Schema
from .version import VERSION, version_string

__version__ = VERSION

__all__ = [
    "CastError",
    "Catalog",
    "CatalogError",
    "Column",
    "ColumnNotFoundError",
    "ConfigurationError",
    "DataSourceError",
    "DataType",
    "DuplicateColumnError",
    "Engine",
    "EngineConfig",
    "ExecutionError",
    "Field",
    "FunctionNotFoundError",
    "ParseError",
    "PlanningError",
    "QueryResult",
    "RecordBatch",
    "Schema",
    "SchemaError",
    "Table",
    "TableAlreadyExistsError",
    "TableNotFoundError",
    "TypeMismatchError",
    "UnsupportedFeatureError",
    "VERSION",
    "VeldtError",
    "__version__",
    "read_csv",
    "read_file",
    "read_jsonl",
    "version_string",
    "write_csv",
    "write_file",
    "write_jsonl",
]
