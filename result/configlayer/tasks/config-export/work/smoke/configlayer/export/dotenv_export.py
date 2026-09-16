"""Render a configuration mapping as dotenv text."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from configlayer.exceptions import ExportError
from configlayer.export.flatten import env_segment, flatten, render_leaf

# Characters that force a value into quotes: whitespace at either end,
# an embedded '#', '=' or quote would otherwise change how the line
# reads back.
_NEEDS_QUOTING = set("#'\"")


def export_dotenv(config: Mapping[str, Any], *, prefix: str = "") -> str:
    """Render *config* as dotenv ``KEY=VALUE`` lines.

    Dotted paths become environment-style names: each segment is
    uppercased and segments are joined with double underscores, the
    inverse of the ``APP_DB__HOST`` convention
    :class:`configlayer.env.EnvParser` reads.  With ``prefix="APP"``
    the key ``db.host`` therefore renders as ``APP_DB__HOST``.

    Lines are sorted by key so the output is deterministic.  Values are
    quoted only when they need it: a value with leading or trailing
    whitespace, an embedded ``#``, ``=`` or quote character, wraps in
    double quotes (or single quotes when it contains a double quote);
    a value containing both quote characters cannot be represented and
    raises :class:`ExportError`.

    Parameters
    ----------
    config:
        Nested configuration mapping.
    prefix:
        Optional application prefix prepended with a single underscore.

    Returns
    -------
    str
        The dotenv document, one ``KEY=VALUE`` per line, trailing
        newline included; an empty config renders as the empty string.
    """
    flat = flatten(config)
    lines = []
    for path in sorted(flat):
        name = "__".join(
            env_segment(segment, path) for segment in path.split(".")
        )
        if prefix:
            name = f"{env_segment(prefix, prefix)}_{name}"
        text = render_leaf(flat[path], path)
        lines.append(f"{name}={_quote(text, path)}")
    return "".join(line + "\n" for line in lines)


def _quote(text: str, path: str) -> str:
    """Quote *text* for a dotenv line when it cannot stand bare."""
    needs = (
        text != text.strip()
        or any(ch in _NEEDS_QUOTING or ch == "=" for ch in text)
        or " " in text
    )
    if not needs:
        return text
    if '"' not in text:
        return f'"{text}"'
    if "'" not in text:
        return f"'{text}'"
    raise ExportError(
        f"{path}: a value containing both quote characters cannot be "
        "written to dotenv"
    )
