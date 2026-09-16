"""Readers and writers for the supported text formats."""

from __future__ import annotations

from .formats import Format, detect_format, format_for_extension, supported_formats
from .readers import read_csv, read_file, read_jsonl, read_rows, source_for
from .writers import (
    to_csv_string,
    to_jsonl_string,
    write_csv,
    write_file,
    write_jsonl,
)

__all__ = [
    "Format",
    "detect_format",
    "format_for_extension",
    "read_csv",
    "read_file",
    "read_jsonl",
    "read_rows",
    "source_for",
    "supported_formats",
    "to_csv_string",
    "to_jsonl_string",
    "write_csv",
    "write_file",
    "write_jsonl",
]
