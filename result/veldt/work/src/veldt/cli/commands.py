"""Implementations of the individual CLI subcommands.

Each command takes parsed arguments and an output stream, and returns a process
exit code. Keeping them free of ``argparse`` means they can be called directly
from tests without constructing a parser.
"""

from __future__ import annotations

import sys
from typing import Any, List, Optional, Sequence, TextIO, Tuple

from ..config import EngineConfig
from ..core.table import Table
from ..engine import Engine
from ..errors import VeldtError
from ..io.readers import read_file, source_for
from ..io.writers import to_csv_string, to_jsonl_string, write_file
from ..plan.printer import format_plan, plan_summary
from ..version import version_string
from .formatting import render_schema, render_table

__all__ = [
    "build_engine",
    "parse_binding",
    "command_query",
    "command_explain",
    "command_schema",
    "command_convert",
    "command_version",
    "EXIT_OK",
    "EXIT_ERROR",
    "EXIT_USAGE",
]

EXIT_OK = 0
EXIT_ERROR = 1
EXIT_USAGE = 2


def parse_binding(binding: str) -> Tuple[str, str]:
    """Split a ``name=path`` command line binding.

    Raises:
        ValueError: If the binding has no ``=`` or an empty half.
    """
    name, separator, path = binding.partition("=")
    if not separator or not name.strip() or not path.strip():
        raise ValueError(
            f"expected NAME=PATH, got {binding!r}"
        )
    return name.strip(), path.strip()


def build_engine(
    csv_bindings: Sequence[str] = (),
    jsonl_bindings: Sequence[str] = (),
    partition_bindings: Sequence[str] = (),
    config: Optional[EngineConfig] = None,
) -> Engine:
    """Create an engine with the tables named on the command line.

    Raises:
        ValueError: If a binding is malformed.
    """
    engine = Engine(config=config)
    for binding in csv_bindings:
        name, path = parse_binding(binding)
        engine.register_csv(name, path, replace=True)
    for binding in jsonl_bindings:
        name, path = parse_binding(binding)
        engine.register_jsonl(name, path, replace=True)
    for binding in partition_bindings:
        name, path = parse_binding(binding)
        engine.register_partitioned(name, path, replace=True)
    return engine


def _render(table: Table, output_format: str, max_rows: Optional[int]) -> str:
    """Render a result table in the requested output format."""
    if output_format == "csv":
        return to_csv_string(table).rstrip("\n")
    if output_format == "json":
        return to_jsonl_string(table).rstrip("\n")
    return render_table(table, max_rows)


def command_query(arguments: Any, stream: Optional[TextIO] = None) -> int:
    """Run a query and print its result."""
    out = stream or sys.stdout
    engine = build_engine(
        arguments.csv,
        arguments.jsonl,
        getattr(arguments, "partitioned", ()),
        EngineConfig(
            batch_size=arguments.batch_size,
            optimize=not arguments.no_optimize,
        ),
    )
    result = engine.sql(arguments.sql)
    rendered = _render(result.table, arguments.output, arguments.max_rows)
    if rendered:
        print(rendered, file=out)
    if arguments.stats:
        print("", file=out)
        print(f"plan: {plan_summary(result.optimized_plan)}", file=out)
        for key in sorted(result.metrics):
            print(f"{key}: {result.metrics[key]}", file=out)
    return EXIT_OK


def command_explain(arguments: Any, stream: Optional[TextIO] = None) -> int:
    """Print the plan for a query without running it."""
    out = stream or sys.stdout
    engine = build_engine(
        arguments.csv, arguments.jsonl, getattr(arguments, "partitioned", ())
    )
    plan = engine.plan(arguments.sql, optimize=not arguments.logical)
    print(format_plan(plan, show_schema=arguments.show_schema), file=out)
    return EXIT_OK


def command_schema(arguments: Any, stream: Optional[TextIO] = None) -> int:
    """Print the schema of one or every registered table."""
    out = stream or sys.stdout
    engine = build_engine(
        arguments.csv, arguments.jsonl, getattr(arguments, "partitioned", ())
    )
    names: List[str] = [arguments.table] if arguments.table else engine.tables()
    if not names:
        print("no tables registered", file=out)
        return EXIT_OK
    for index, name in enumerate(names):
        if index:
            print("", file=out)
        print(render_schema(engine.schema(name), name), file=out)
    return EXIT_OK


def command_convert(arguments: Any, stream: Optional[TextIO] = None) -> int:
    """Convert a file from one supported format to another."""
    out = stream or sys.stdout
    table = read_file(arguments.source)
    written = write_file(table, arguments.destination)
    print(f"wrote {written} rows to {arguments.destination}", file=out)
    return EXIT_OK


def command_version(arguments: Any, stream: Optional[TextIO] = None) -> int:
    """Print the engine version."""
    print(version_string(), file=stream or sys.stdout)
    return EXIT_OK
