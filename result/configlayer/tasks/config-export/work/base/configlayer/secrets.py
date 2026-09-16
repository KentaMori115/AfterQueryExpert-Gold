"""Stub of configlayer.secrets — masks secret-bearing keys."""

from collections.abc import Mapping

MASK = "***"
_SECRET_HINTS = ("password", "passwd", "secret", "token", "api_key", "apikey",
                 "private_key", "credential")


def _is_secret(key):
    low = key.lower()
    return any(hint in low for hint in _SECRET_HINTS)


def redact(data, mask=MASK):
    """Return a copy of *data* with secret-bearing leaves masked."""
    if not isinstance(data, Mapping):
        return data
    out = {}
    for key, value in data.items():
        if isinstance(value, Mapping):
            out[key] = redact(value, mask)
        elif isinstance(key, str) and _is_secret(key):
            out[key] = mask
        else:
            out[key] = value
    return out
