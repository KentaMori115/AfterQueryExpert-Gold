"""configlayer.export — render resolved configuration back out as text.

A merged configuration usually flows *into* an application, but it also
needs to flow out: written to disk for another process, templated into a
container environment, or logged for a support ticket.  This package
renders a nested mapping into three formats — canonical JSON, dotenv
``KEY=VALUE`` lines and INI sections — deterministically (keys sorted,
stable quoting) so exports diff cleanly, with an option to mask secrets
on the way out via :func:`configlayer.secrets.redact`.

:func:`export_config` is the entry point most callers want; the
per-format functions are exported for direct use.
"""

from collections.abc import Mapping
from typing import Any

from configlayer.exceptions import ExportError
from configlayer.export.dotenv_export import export_dotenv
from configlayer.export.files import export_path
from configlayer.export.ini_export import export_ini
from configlayer.export.json_export import export_json
from configlayer.secrets import redact

# Canonical format name -> renderer.
_RENDERERS = {
    "json": export_json,
    "dotenv": export_dotenv,
    "ini": export_ini,
}


def export_formats() -> list[str]:
    """Return the sorted list of formats :func:`export_config` accepts."""
    return sorted(_RENDERERS)


def export_config(
    config: Mapping[str, Any],
    format: str = "json",  # noqa: A002 — matches loader/source vocabulary
    *,
    redact_secrets: bool = False,
    prefix: str = "",
) -> str:
    """Render *config* in the given *format*.

    Parameters
    ----------
    config:
        The nested configuration mapping to render (e.g. a merged dict
        or ``LayeredConfig.as_dict()``).
    format:
        ``"json"``, ``"dotenv"`` or ``"ini"`` (case-insensitive).
    redact_secrets:
        When ``True`` the mapping is first passed through
        :func:`configlayer.secrets.redact`, so secret-bearing keys are
        masked in the rendered text.
    prefix:
        Environment-name prefix, honoured by the dotenv format only.

    Returns
    -------
    str
        The rendered document.

    Raises
    ------
    ExportError
        If *format* is unknown, or the data cannot be represented in
        the chosen format.
    """
    if not isinstance(config, Mapping):
        raise ExportError(
            f"export_config needs a mapping, got {type(config).__name__}"
        )
    key = format.lower()
    renderer = _RENDERERS.get(key)
    if renderer is None:
        raise ExportError(
            f"Unknown export format {format!r}. "
            f"Known formats: {export_formats()}."
        )
    data: Mapping[str, Any] = redact(config) if redact_secrets else config
    if key == "dotenv":
        return export_dotenv(data, prefix=prefix)
    return renderer(data)


__all__ = [
    "ExportError",
    "export_config",
    "export_dotenv",
    "export_formats",
    "export_ini",
    "export_json",
    "export_path",
]
