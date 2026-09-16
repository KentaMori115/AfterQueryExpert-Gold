"""Content hashing used for caching, manifests and idempotency."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

_CHUNK_SIZE = 1024 * 1024


def sha256_text(text: str) -> str:
    """Return the SHA-256 hex digest of ``text``."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def sha256_file(path: Path) -> str:
    """Return the SHA-256 hex digest of a file, read in chunks."""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(_CHUNK_SIZE):
            digest.update(chunk)
    return digest.hexdigest()


def prompt_hash(prompt: str, **params: Any) -> str:
    """Return a stable cache key for a prompt plus its generation parameters."""
    payload = json.dumps(
        {"prompt": prompt, "params": params}, sort_keys=True, ensure_ascii=False, default=str
    )
    return sha256_text(payload)
