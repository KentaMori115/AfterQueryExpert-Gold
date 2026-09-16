"""A stable fingerprint of a document, so two runs can be compared.

The digest is over canonical JSON: keys sorted, no incidental whitespace, and no
floats anywhere. A float would make the digest depend on how the platform prints
it, which is exactly the sort of thing a fingerprint is supposed to catch.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

from layover.errors import DocumentError

__all__ = ["canonical_json", "check_no_floats", "digest_of", "short_digest"]


def check_no_floats(value: Any, path: str = "") -> None:
    """Raise if a float hides anywhere inside the structure."""
    if isinstance(value, float):
        raise DocumentError("a document cannot hold a float: %s is %r" % (path or "value", value))
    if isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str):
                raise DocumentError("a document key has to be text, got %r" % (key,))
            check_no_floats(item, "%s.%s" % (path, key) if path else str(key))
    elif isinstance(value, (list, tuple)):
        for index, item in enumerate(value):
            check_no_floats(item, "%s[%d]" % (path, index))


def canonical_json(document: Any) -> str:
    """Render a document as JSON that only depends on what it holds."""
    check_no_floats(document)
    return json.dumps(
        document,
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":"),
        allow_nan=False,
    )


def digest_of(document: Any) -> str:
    """The sha256 of the canonical rendering, as hex."""
    return hashlib.sha256(canonical_json(document).encode("utf-8")).hexdigest()


def short_digest(document: Any, length: int = 12) -> str:
    """The first characters of the digest, for a log line or a report."""
    if length < 4 or length > 64:
        raise DocumentError("a short digest is between 4 and 64 characters, got %d" % length)
    return digest_of(document)[:length]
