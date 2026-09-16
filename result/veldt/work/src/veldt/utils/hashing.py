"""Stable hashing for grouping and join keys.

Python's built-in ``hash`` is randomised per process for strings, and it treats
``1``, ``1.0`` and ``True`` as the same key. Grouping needs a deterministic
function that distinguishes those, so the engine builds its own key tuples.
"""

from __future__ import annotations

import hashlib
from datetime import date, datetime
from typing import Any, Iterable, Sequence, Tuple

__all__ = ["value_key", "row_key", "stable_hash", "fingerprint"]


def value_key(value: Any) -> Tuple[str, Any]:
    """Return a hashable key that preserves the value's type identity.

    ``True`` and ``1`` produce different keys, as do ``1`` and ``1.0``, which
    matters when a ``GROUP BY`` runs over a column of mixed provenance.
    """
    if value is None:
        return ("null", None)
    if isinstance(value, bool):
        return ("bool", value)
    if isinstance(value, int):
        return ("int", value)
    if isinstance(value, float):
        if value != value:  # NaN never equals itself; collapse to one key.
            return ("float", "nan")
        return ("float", value)
    if isinstance(value, str):
        return ("str", value)
    if isinstance(value, datetime):
        return ("ts", value.isoformat())
    if isinstance(value, date):
        return ("date", value.isoformat())
    if isinstance(value, (list, tuple)):
        return ("seq", tuple(value_key(item) for item in value))
    return ("obj", repr(value))


def row_key(values: Iterable[Any]) -> Tuple[Tuple[str, Any], ...]:
    """Return a composite key for a sequence of column values."""
    return tuple(value_key(value) for value in values)


def stable_hash(value: Any) -> int:
    """Return a process-independent 64-bit hash of ``value``."""
    digest = hashlib.blake2b(_encode(value_key(value)).encode("utf-8"), digest_size=8)
    return int.from_bytes(digest.digest(), "big")


def fingerprint(values: Sequence[Any], length: int = 12) -> str:
    """Return a short hex fingerprint for a sequence of values."""
    payload = "".join(_encode(value_key(value)) for value in values)
    return hashlib.blake2b(payload.encode("utf-8"), digest_size=16).hexdigest()[:length]


def _encode(key: Any) -> str:
    """Render a nested key tuple as an unambiguous string."""
    if isinstance(key, tuple):
        return "(" + ",".join(_encode(part) for part in key) + ")"
    return repr(key)
