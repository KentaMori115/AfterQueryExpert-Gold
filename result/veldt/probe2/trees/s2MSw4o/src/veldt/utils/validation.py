"""Argument checking helpers with consistent error messages."""

from __future__ import annotations

from typing import Any, Callable, Collection, Iterable, Optional, Sequence, Tuple, Type, TypeVar

T = TypeVar("T")

__all__ = [
    "require",
    "require_type",
    "require_positive",
    "require_non_negative",
    "require_non_empty",
    "require_one_of",
    "require_unique",
    "require_same_length",
]


def require(condition: bool, message: str, error: Type[Exception] = ValueError) -> None:
    """Raise ``error(message)`` unless ``condition`` holds."""
    if not condition:
        raise error(message)


def require_type(value: T, expected: Tuple[type, ...] | type, name: str) -> T:
    """Return ``value`` after checking its runtime type."""
    if not isinstance(value, expected):
        names = expected if isinstance(expected, tuple) else (expected,)
        wanted = " or ".join(item.__name__ for item in names)
        raise TypeError(f"{name} must be {wanted}, got {type(value).__name__}")
    return value


def require_positive(value: int, name: str) -> int:
    """Return ``value`` after checking it is strictly greater than zero."""
    if value <= 0:
        raise ValueError(f"{name} must be positive, got {value}")
    return value


def require_non_negative(value: int, name: str) -> int:
    """Return ``value`` after checking it is zero or greater."""
    if value < 0:
        raise ValueError(f"{name} must not be negative, got {value}")
    return value


def require_non_empty(value: Collection[Any], name: str) -> Collection[Any]:
    """Return ``value`` after checking it contains at least one element."""
    if len(value) == 0:
        raise ValueError(f"{name} must not be empty")
    return value


def require_one_of(value: T, options: Sequence[T], name: str) -> T:
    """Return ``value`` after checking membership in ``options``."""
    if value not in options:
        allowed = ", ".join(repr(item) for item in options)
        raise ValueError(f"{name} must be one of {allowed}, got {value!r}")
    return value


def require_unique(
    values: Iterable[Any],
    name: str,
    key: Optional[Callable[[Any], Any]] = None,
) -> None:
    """Raise when ``values`` contains a repeated element."""
    seen: set = set()
    for item in values:
        marker = key(item) if key is not None else item
        if marker in seen:
            raise ValueError(f"{name} contains duplicate entry {marker!r}")
        seen.add(marker)


def require_same_length(left: Sequence[Any], right: Sequence[Any], name: str) -> None:
    """Raise when two sequences differ in length."""
    if len(left) != len(right):
        raise ValueError(f"{name} length mismatch: {len(left)} != {len(right)}")
