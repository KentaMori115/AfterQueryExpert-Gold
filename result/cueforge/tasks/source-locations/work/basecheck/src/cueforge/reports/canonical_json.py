"""Canonical JSON serialization and content digests."""

from __future__ import annotations

import hashlib
import json
from typing import Any


def _normalize(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, bool)):
        return value
    if isinstance(value, float):
        raise TypeError("canonical JSON does not accept binary floats")
    if isinstance(value, dict):
        return {str(key): _normalize(value[key]) for key in sorted(value, key=lambda item: str(item))}
    if isinstance(value, (list, tuple)):
        return [_normalize(item) for item in value]
    raise TypeError(f"cannot canonicalize {type(value).__name__}")


def canonical_dumps(value: Any) -> str:
    """UTF-8 JSON, sorted keys, minimal separators, exactly one trailing newline."""
    payload = _normalize(value)
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n"


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
