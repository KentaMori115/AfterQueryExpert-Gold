"""Build a Production model from a loaded mapping."""

from __future__ import annotations

from typing import Any

from pydantic import ValidationError

from cueforge.codes import CF1004_SCHEMA_VERSION, CF1005_PARSE_ERROR, CF1009_UNKNOWN_FIELD, CF1010_TYPE_ERROR
from cueforge.findings import Finding, Severity, SourceRef
from cueforge.production.models import Production, SUPPORTED_SCHEMA_VERSIONS
from cueforge.production.source_map import SourceMap


def _error_ref(positions: SourceMap | None, loc: tuple[Any, ...], kind: str) -> SourceRef | None:
    """Which authored node a validation error is about.

    An unknown field is the key that named it, a missing field is the
    mapping that lacks it, and anything else is the value that was rejected
    (or, when the value sits deeper than the document does, the closest
    enclosing node).
    """
    if positions is None:
        return None
    path = tuple(loc)
    if "extra" in kind:
        return positions.key(path) or positions.nearest(path[:-1])
    if kind == "missing":
        return positions.nearest(path[:-1])
    return positions.nearest(path)


def production_from_mapping(
    data: dict[str, Any],
    source_path: str,
    positions: SourceMap | None = None,
) -> tuple[Production | None, list[Finding]]:
    findings: list[Finding] = []
    version = data.get("version")
    if version is not None:
        try:
            version_int = int(str(version), 10)
        except ValueError:
            version_int = -1
        if version_int not in SUPPORTED_SCHEMA_VERSIONS:
            findings.append(
                Finding(
                    code=CF1004_SCHEMA_VERSION,
                    severity=Severity.ERROR,
                    message=f"unsupported schema version {version}",
                    subject_kind="production",
                    subject_id=str(data.get("production", source_path)),
                    witness={"version": str(version)},
                    source=positions.value(("version",)) if positions is not None else None,
                )
            )
            return None, findings
    try:
        production = Production.model_validate(
            {**data, "source_path": source_path, "source_map": positions}
        )
    except ValidationError as exc:
        for error in exc.errors():
            loc = tuple(error.get("loc", ()))
            kind = str(error.get("type", ""))
            code = CF1009_UNKNOWN_FIELD if "extra" in kind else CF1010_TYPE_ERROR
            if "value_error" in kind:
                code = CF1005_PARSE_ERROR
            findings.append(
                Finding(
                    code=code,
                    severity=Severity.ERROR,
                    message=f"{'.'.join(map(str, loc))}: {error.get('msg', 'invalid value')}",
                    subject_kind="document",
                    subject_id=".".join(map(str, loc)) or source_path,
                    witness={"path": source_path},
                    source=_error_ref(positions, loc, kind),
                )
            )
        return None, findings
    return production, findings
