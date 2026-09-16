"""Output formatting for the command line interface."""

from __future__ import annotations

import csv
import io
import json
from typing import Any, Iterable, Optional

from ..errors import ConfigurationError
from ..result import QueryResult
from ..util.table_render import format_cell, render_table

__all__ = ["FORMATS", "format_result", "format_rows"]

FORMATS = ("table", "csv", "tsv", "json", "jsonl", "vertical")


def format_result(
    result: QueryResult,
    fmt: str = "table",
    *,
    max_rows: Optional[int] = None,
    max_width: int = 40,
    null_text: str = "NULL",
) -> str:
    """Render a query result in the requested format."""

    if fmt not in FORMATS:
        raise ConfigurationError(
            f"unknown output format {fmt!r}",
            hint="available formats: " + ", ".join(FORMATS),
        )
    if fmt == "table":
        return render_table(
            result.schema.names,
            result.rows,
            max_rows=max_rows,
            max_width=max_width,
            null_text=null_text,
        )
    if fmt == "vertical":
        return _format_vertical(result, null_text=null_text)
    if fmt in ("csv", "tsv"):
        return _format_delimited(
            result, delimiter="," if fmt == "csv" else "\t", null_text=""
        )
    if fmt == "json":
        return json.dumps(result.to_dicts(), indent=2, default=_json_default)
    return "\n".join(
        json.dumps(record, default=_json_default) for record in result.to_dicts()
    )


def format_rows(
    columns: Iterable[str], rows: Iterable[Iterable[Any]], fmt: str = "table"
) -> str:
    """Render bare rows without constructing a full result object."""

    from ..types.datatypes import STRING
    from ..types.schema import Field, Schema

    schema = Schema(Field(name=name, dtype=STRING) for name in columns)
    materialized = [list(row) for row in rows]
    return format_result(QueryResult(schema=schema, rows=materialized), fmt)


def _format_vertical(result: QueryResult, *, null_text: str) -> str:
    names = result.schema.names
    if not names:
        return "(no columns)"
    width = max(len(name) for name in names)
    blocks: list[str] = []
    for index, row in enumerate(result.rows, start=1):
        lines = [f"-[ RECORD {index} ]-"]
        for name, value in zip(names, row):
            lines.append(f"{name.ljust(width)} | {format_cell(value, null_text=null_text)}")
        blocks.append("\n".join(lines))
    return "\n".join(blocks) if blocks else "(0 rows)"


def _format_delimited(result: QueryResult, *, delimiter: str, null_text: str) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=delimiter, lineterminator="\n")
    writer.writerow(result.schema.names)
    for row in result.rows:
        writer.writerow(
            [null_text if value is None else format_cell(value) for value in row]
        )
    return buffer.getvalue().rstrip("\n")


def _json_default(value: Any) -> Any:
    import datetime as dt

    if isinstance(value, (dt.date, dt.datetime)):
        return value.isoformat()
    return str(value)
