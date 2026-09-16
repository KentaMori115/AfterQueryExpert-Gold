"""Write exported configuration straight to a file."""

from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path
from typing import Any

from configlayer.exceptions import ExportError

# File extension (lowercased) -> export format.  Mirrors the reader-side
# conventions: FileSource reads .json and .env, INILoader text usually
# lives in .ini files.
_EXT_TO_FORMAT: dict[str, str] = {
    ".json": "json",
    ".env": "dotenv",
    ".ini": "ini",
}


def export_path(
    config: Mapping[str, Any],
    path: str,
    *,
    format: str | None = None,  # noqa: A002 — matches package vocabulary
    redact_secrets: bool = False,
    prefix: str = "",
    encoding: str = "utf-8",
) -> str:
    """Render *config* and write it to *path* in one step.

    The format comes from the file extension — ``.json``, ``.env`` for
    dotenv, ``.ini`` — unless *format* names one explicitly.  The
    rendered text is written with *encoding* and also returned, so a
    caller can log or diff what landed on disk.

    Parameters
    ----------
    config:
        Nested configuration mapping.
    path:
        Destination file path.
    format:
        Explicit format override; when given, the extension is only
        cosmetic.
    redact_secrets:
        Forwarded to :func:`configlayer.export.export_config`.
    prefix:
        Forwarded to the dotenv renderer.
    encoding:
        Text encoding for the written file.

    Returns
    -------
    str
        The text that was written.

    Raises
    ------
    ExportError
        If neither *format* nor the extension identifies a format, or
        the data cannot be represented in it.
    """
    from configlayer.export import export_config

    chosen = format
    if chosen is None:
        ext = Path(path).suffix.lower()
        chosen = _EXT_TO_FORMAT.get(ext)
        if chosen is None:
            raise ExportError(
                f"Cannot pick an export format for {path!r}. "
                f"Known extensions: {sorted(_EXT_TO_FORMAT)}. "
                "Pass format= explicitly."
            )
    text = export_config(
        config, chosen, redact_secrets=redact_secrets, prefix=prefix
    )
    Path(path).write_text(text, encoding=encoding)
    return text
