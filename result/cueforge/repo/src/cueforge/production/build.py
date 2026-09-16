"""Build a Production model from a loaded mapping."""

from __future__ import annotations

from typing import Any

from pydantic import ValidationError

from cueforge.codes import CF1004_SCHEMA_VERSION, CF1005_PARSE_ERROR, CF1009_UNKNOWN_FIELD, CF1010_TYPE_ERROR
from cueforge.findings import Finding, Severity
from cueforge.production.models import Production, SUPPORTED_SCHEMA_VERSIONS


def production_from_mapping(data: dict[str, Any], source_path: str) -> tuple[Production | None, list[Finding]]:
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
                )
            )
            return None, findings
    try:
        production = Production.model_validate({**data, "source_path": source_path})
    except ValidationError as exc:
        for error in exc.errors():
            loc = ".".join(str(part) for part in error.get("loc", ()))
            kind = error.get("type", "")
            code = CF1009_UNKNOWN_FIELD if "extra" in kind else CF1010_TYPE_ERROR
            if "value_error" in kind:
                code = CF1005_PARSE_ERROR
            findings.append(
                Finding(
                    code=code,
                    severity=Severity.ERROR,
                    message=f"{loc}: {error.get('msg', 'invalid value')}",
                    subject_kind="document",
                    subject_id=loc or source_path,
                    witness={"path": source_path},
                )
            )
        return None, findings
    return production, findings
