"""Render a configuration mapping as canonical JSON text."""

from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any

from configlayer.exceptions import ExportError


def export_json(config: Mapping[str, Any]) -> str:
    """Render *config* as canonical, diff-friendly JSON.

    Keys are sorted at every level, indentation is two spaces, and the
    text ends with a trailing newline, so exporting the same data always
    produces byte-identical output.  Values must be JSON-representable
    (mappings, lists, strings, numbers, booleans, None); anything else
    raises :class:`ExportError` naming the offending type.

    Returns
    -------
    str
        The JSON document.
    """
    plain = _plain(config, "<root>")
    return json.dumps(plain, indent=2, sort_keys=True) + "\n"


def _plain(value: Any, path: str) -> Any:
    """Copy *value* into plain JSON-ready structures, checking types."""
    if isinstance(value, Mapping):
        out = {}
        for key, item in value.items():
            if not isinstance(key, str) or not key:
                raise ExportError(
                    f"cannot export non-string key {key!r} under {path!r}"
                )
            out[key] = _plain(item, f"{path}.{key}")
        return out
    if isinstance(value, list):
        return [_plain(item, f"{path}[{i}]") for i, item in enumerate(value)]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    raise ExportError(
        f"{path}: cannot render {type(value).__name__} as JSON"
    )
