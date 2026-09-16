"""Merge multi-file production documents into one authored mapping."""

from __future__ import annotations

from typing import Any

from cueforge.codes import CF1001_DUPLICATE_ID, CF1010_TYPE_ERROR
from cueforge.findings import Finding, Severity


_MAP_KEYS = ("resources", "performers", "locations", "events", "departments")
_LIST_KEYS = ("cues", "assertions")


def merge_documents(documents: list[tuple[str, dict[str, Any]]]) -> tuple[dict[str, Any], list[Finding]]:
    """Merge documents. Duplicate map keys are errors. Lists concatenate in file order."""
    merged: dict[str, Any] = {}
    findings: list[Finding] = []
    seen_maps: dict[str, dict[str, str]] = {key: {} for key in _MAP_KEYS}

    for path, document in documents:
        if not isinstance(document, dict):
            findings.append(
                Finding(
                    code=CF1010_TYPE_ERROR,
                    severity=Severity.ERROR,
                    message=f"production document must be a mapping: {path}",
                    subject_kind="document",
                    subject_id=path,
                )
            )
            continue
        for key, value in document.items():
            if key in _MAP_KEYS:
                if not isinstance(value, dict):
                    findings.append(
                        Finding(
                            code=CF1010_TYPE_ERROR,
                            severity=Severity.ERROR,
                            message=f"{key} must be a mapping in {path}",
                            subject_kind=key,
                            subject_id=path,
                        )
                    )
                    continue
                bucket = merged.setdefault(key, {})
                for item_id, item in value.items():
                    prior = seen_maps[key].get(item_id)
                    if prior is not None:
                        findings.append(
                            Finding(
                                code=CF1001_DUPLICATE_ID,
                                severity=Severity.ERROR,
                                message=f"duplicate {key} id {item_id!r} in {path} (already in {prior})",
                                subject_kind=key,
                                subject_id=item_id,
                                witness={"first_path": prior, "second_path": path},
                            )
                        )
                        continue
                    seen_maps[key][item_id] = path
                    bucket[item_id] = item
            elif key in _LIST_KEYS:
                if not isinstance(value, list):
                    findings.append(
                        Finding(
                            code=CF1010_TYPE_ERROR,
                            severity=Severity.ERROR,
                            message=f"{key} must be a list in {path}",
                            subject_kind=key,
                            subject_id=path,
                        )
                    )
                    continue
                merged.setdefault(key, []).extend(value)
            elif key in merged and merged[key] != value:
                findings.append(
                    Finding(
                        code=CF1001_DUPLICATE_ID,
                        severity=Severity.ERROR,
                        message=f"conflicting top-level field {key!r} in {path}",
                        subject_kind="field",
                        subject_id=key,
                        witness={"path": path},
                    )
                )
            else:
                merged[key] = value
    return merged, findings
