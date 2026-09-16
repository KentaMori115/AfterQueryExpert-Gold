"""SlateQL -- an embeddable analytical SQL engine written in pure Python.

The package is organised as a classic query pipeline:

===================  ==========================================================
:mod:`slateql.sql`       lexing and parsing into an AST
:mod:`slateql.analyze`   name resolution, type checking, logical plan building
:mod:`slateql.optimize`  rule-based logical plan rewriting
:mod:`slateql.execution` physical planning and vectorised execution
:mod:`slateql.storage`   the catalog, tables, and data sources
===================  ==========================================================

Most callers only need :class:`slateql.session.Session`:

>>> from slateql import Session
>>> session = Session()
>>> session.register_dicts("nums", [{"n": 1}, {"n": 2}, {"n": 3}])
>>> session.sql("SELECT SUM(n) AS total FROM nums").scalar()
6
"""

from .config import DEFAULT_CONFIG, SessionConfig
from .errors import (
    BindingError,
    ExecutionError,
    ParseError,
    PlanningError,
    SlateQLError,
    StorageError,
    TypeMismatchError,
    UnknownColumnError,
    UnknownFunctionError,
    UnknownTableError,
)
from .result import QueryResult
from .session import Session
from .storage.catalog import Catalog
from .storage.sources import CsvSource, DataSource, JsonlSource, MemorySource
from .types.datatypes import (
    BOOLEAN,
    DATE,
    DOUBLE,
    INTEGER,
    STRING,
    TIMESTAMP,
    DataType,
    TypeKind,
)
from .types.schema import Field, Schema
from .version import VERSION, version_tuple

__version__ = VERSION

__all__ = [
    "Session",
    "SessionConfig",
    "DEFAULT_CONFIG",
    "QueryResult",
    "Catalog",
    "CsvSource",
    "DataSource",
    "JsonlSource",
    "MemorySource",
    "Schema",
    "Field",
    "DataType",
    "TypeKind",
    "BOOLEAN",
    "DATE",
    "DOUBLE",
    "INTEGER",
    "STRING",
    "TIMESTAMP",
    "SlateQLError",
    "ParseError",
    "BindingError",
    "PlanningError",
    "ExecutionError",
    "StorageError",
    "TypeMismatchError",
    "UnknownColumnError",
    "UnknownFunctionError",
    "UnknownTableError",
    "VERSION",
    "__version__",
    "version_tuple",
]
