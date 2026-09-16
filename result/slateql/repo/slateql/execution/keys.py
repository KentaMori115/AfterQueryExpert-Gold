"""Grouping keys.

SQL's grouping semantics differ from its comparison semantics: ``NULL = NULL``
is unknown, but GROUP BY, DISTINCT, and hash-join probing all treat two NULLs
as the same key.  These helpers build hashable keys with that rule, and they
keep booleans distinct from the integers Python considers equal to them.
"""

from __future__ import annotations

from typing import Any, Sequence

__all__ = ["value_key", "row_key", "keys_for", "key_is_null_free"]

_BOOL_TAG = 1
_PLAIN_TAG = 0


def value_key(value: Any) -> tuple[int, Any]:
    """Return a hashable key for one value.

    ``True`` and ``1`` compare equal and hash equally in Python, which would
    silently merge a boolean group with an integer group; tagging booleans
    keeps them apart.
    """

    if isinstance(value, bool):
        return (_BOOL_TAG, value)
    return (_PLAIN_TAG, value)


def row_key(row: Sequence[Any]) -> tuple:
    """Return a hashable key covering every column of ``row``."""

    return tuple(value_key(value) for value in row)


def keys_for(row: Sequence[Any], indices: Sequence[int]) -> tuple:
    """Return a key covering only the columns named by ``indices``."""

    return tuple(value_key(row[index]) for index in indices)


def key_is_null_free(key: Sequence[tuple[int, Any]]) -> bool:
    """Whether a key contains no NULL components.

    Equi-joins must not match on NULL, so the hash join uses this to decide
    whether a probe key can produce matches at all.
    """

    return all(part[1] is not None for part in key)
