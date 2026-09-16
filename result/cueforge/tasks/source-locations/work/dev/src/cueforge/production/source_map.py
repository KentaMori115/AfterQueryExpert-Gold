"""Normalize source paths and record where authored nodes sit."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field, replace
from pathlib import Path

from cueforge.codes import CF1003_PATH_ESCAPE
from cueforge.findings import Finding, Severity, SourceRef

NodePath = tuple[str | int, ...]


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


@dataclass
class SourceMap:
    """Where every authored node sits, keyed by its path in the loaded mapping.

    A path is the sequence of mapping keys and list indices that reaches the
    node from the document root, ``("cues", 2, "trigger", "after")`` for
    example.  ``values`` holds the first character of the node itself,
    ``keys`` the first character of the key that introduced it.  Lines and
    columns are 1-based.
    """

    values: dict[NodePath, SourceRef] = field(default_factory=dict)
    keys: dict[NodePath, SourceRef] = field(default_factory=dict)

    def add_value(self, path: Iterable[str | int], ref: SourceRef) -> None:
        self.values[tuple(path)] = ref

    def add_key(self, path: Iterable[str | int], ref: SourceRef) -> None:
        self.keys[tuple(path)] = ref

    def value(self, path: Iterable[str | int]) -> SourceRef | None:
        return self.values.get(tuple(path))

    def key(self, path: Iterable[str | int]) -> SourceRef | None:
        return self.keys.get(tuple(path))

    def nearest(self, path: Iterable[str | int]) -> SourceRef | None:
        """The node at ``path``, or the closest node that encloses it."""
        full = tuple(path)
        for length in range(len(full), -1, -1):
            ref = self.values.get(full[:length])
            if ref is not None:
                return ref
        return None

    def absorb(self, other: SourceMap, list_offsets: Mapping[str, int]) -> None:
        """Take another file's positions, shifting list indices by ``list_offsets``.

        A position already known for a path is kept, which matches the merge
        rule that the first document to set a top-level value owns it.
        """
        for source, target in ((other.values, self.values), (other.keys, self.keys)):
            for path, ref in source.items():
                shifted = path
                if len(path) > 1 and isinstance(path[1], int) and path[0] in list_offsets:
                    shifted = (path[0], path[1] + list_offsets[str(path[0])], *path[2:])
                target.setdefault(shifted, ref)


def located(finding: Finding, ref: SourceRef | None) -> Finding:
    """Return ``finding`` carrying ``ref``, unless it already has a source."""
    if ref is None or finding.source is not None:
        return finding
    return replace(finding, source=ref)
