"""Normalize source paths and record locations."""

from __future__ import annotations

from pathlib import Path

from cueforge.codes import CF1003_PATH_ESCAPE
from cueforge.findings import Finding, Severity, SourceRef


def posix_relpath(path: str) -> str:
    text = path.replace("\\", "/")
    while text.startswith("./"):
        text = text[2:]
    return text


def normalize_source_path(path: str | Path, *, root: Path | None = None) -> str:
    text = posix_relpath(str(path))
    if root is not None:
        try:
            text = Path(path).resolve().relative_to(root.resolve()).as_posix()
        except ValueError:
            text = posix_relpath(str(path))
    return text


def is_path_escape(raw: str) -> bool:
    posix = posix_relpath(raw)
    if posix.startswith("/") or (len(posix) >= 2 and posix[1] == ":"):
        return True
    parts = posix.split("/")
    return any(part == ".." for part in parts)


def path_escape_finding(raw: str) -> Finding:
    return Finding(
        code=CF1003_PATH_ESCAPE,
        severity=Severity.ERROR,
        message=f"source path escapes the production root: {raw}",
        subject_kind="path",
        subject_id=raw,
        witness={"path": raw},
    )


def ref_for(path: str, line: int = 1, column: int = 1) -> SourceRef:
    return SourceRef(path=posix_relpath(path), line=line, column=column)
