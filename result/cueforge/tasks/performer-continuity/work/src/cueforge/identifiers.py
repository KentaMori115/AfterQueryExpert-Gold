"""Stable identifier rules for cues, resources, and other named entities."""

from __future__ import annotations

import re

from cueforge.findings import Finding, Severity

_IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_\-]*$")

MAX_IDENTIFIER_LENGTH = 128


def is_valid_identifier(value: str) -> bool:
    return bool(value) and len(value) <= MAX_IDENTIFIER_LENGTH and _IDENT_RE.match(value) is not None


def identifier_finding(kind: str, value: str, path: str = "") -> Finding:
    return Finding(
        code="CF1007",
        severity=Severity.ERROR,
        message=f"invalid {kind} identifier {value!r}",
        subject_kind=kind,
        subject_id=value,
        witness={"path": path} if path else {},
    )
