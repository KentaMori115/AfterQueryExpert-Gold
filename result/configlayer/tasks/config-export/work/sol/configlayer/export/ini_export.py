"""Render a configuration mapping as INI text."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from configlayer.exceptions import ExportError
from configlayer.export.flatten import flatten, render_leaf


def export_ini(config: Mapping[str, Any]) -> str:
    """Render *config* as INI sections.

    Every top-level key must map to a mapping and becomes a
    ``[section]``; deeper nesting flattens into dotted option names
    inside its section, so ``{"db": {"pool": {"size": 10}}}`` renders
    as ``[db]`` with ``pool.size = 10``.  A scalar at the top level has
    no section to live in and raises :class:`ExportError`.

    Sections and the options inside them are sorted and options render
    as ``name = value``, exactly as
    :class:`configlayer.loader.INILoader` — which parses with
    interpolation disabled — reads them back.

    Returns
    -------
    str
        The INI document; sections are separated by a blank line and
        the text ends with a trailing newline.  An empty config renders
        as the empty string.
    """
    blocks = []
    for section in sorted(config):
        value = config[section]
        if not isinstance(value, Mapping):
            raise ExportError(
                f"{section}: INI export needs every top-level value to "
                "be a mapping"
            )
        options = flatten(value)
        lines = [f"[{section}]"]
        for name in sorted(options):
            text = render_leaf(options[name], f"{section}.{name}")
            lines.append(f"{name} = {text}")
        blocks.append("\n".join(lines))
    if not blocks:
        return ""
    return "\n\n".join(blocks) + "\n"
