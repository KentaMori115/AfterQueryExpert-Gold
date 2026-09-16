"""SHA-256 artifact integrity helpers."""

from __future__ import annotations

from cueforge.codes import CF8001_INTEGRITY, CF8002_CACHE_CONFLICT
from cueforge.findings import Finding, Severity
from cueforge.reports.canonical_json import sha256_bytes, sha256_text


def hash_text(text: str) -> str:
    return sha256_text(text)


def hash_bytes(data: bytes) -> str:
    return sha256_bytes(data)


def integrity_error(digest: str, message: str) -> Finding:
    return Finding(
        code=CF8001_INTEGRITY,
        severity=Severity.ERROR,
        message=message,
        subject_kind="run",
        subject_id=digest,
    )


def cache_conflict(digest: str) -> Finding:
    return Finding(
        code=CF8002_CACHE_CONFLICT,
        severity=Severity.ERROR,
        message=f"run {digest} already exists with different artifacts",
        subject_kind="run",
        subject_id=digest,
    )
