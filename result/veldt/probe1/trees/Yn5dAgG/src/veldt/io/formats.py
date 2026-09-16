"""Format detection and naming.

The engine supports two text formats. Everything that has to decide which one
a path refers to goes through here, so adding a third format means touching one
table rather than four call sites.
"""

from __future__ import annotations

import os
from typing import Dict, List, Optional

from ..errors import DataSourceError

__all__ = ["Format", "detect_format", "format_for_extension", "supported_formats"]


class Format:
    """The supported format names."""

    CSV = "csv"
    TSV = "tsv"
    JSONL = "jsonl"

    ALL = (CSV, TSV, JSONL)


_EXTENSIONS: Dict[str, str] = {
    ".csv": Format.CSV,
    ".tsv": Format.TSV,
    ".tab": Format.TSV,
    ".txt": Format.CSV,
    ".jsonl": Format.JSONL,
    ".ndjson": Format.JSONL,
    ".json": Format.JSONL,
}

_DELIMITERS: Dict[str, str] = {Format.CSV: ",", Format.TSV: "\t"}


def supported_formats() -> List[str]:
    """Return every format name the engine can read or write."""
    return list(Format.ALL)


def format_for_extension(extension: str) -> Optional[str]:
    """Return the format a file extension implies, or ``None``."""
    return _EXTENSIONS.get(extension.lower())


def detect_format(path: str, default: Optional[str] = None) -> str:
    """Infer a file's format from its extension.

    Args:
        path: The file path to inspect.
        default: Format to fall back on when the extension is unknown.

    Raises:
        DataSourceError: If the extension is unrecognised and no default was
            supplied.
    """
    _, extension = os.path.splitext(path)
    detected = format_for_extension(extension)
    if detected is not None:
        return detected
    if default is not None:
        return default
    known = ", ".join(sorted(_EXTENSIONS))
    raise DataSourceError(
        f"cannot determine the format of {path!r}; known extensions are {known}"
    )


def delimiter_for(format_name: str) -> str:
    """Return the field separator a delimited format uses.

    Raises:
        DataSourceError: If the format is not delimited.
    """
    try:
        return _DELIMITERS[format_name]
    except KeyError:
        raise DataSourceError(f"{format_name} is not a delimited format") from None
