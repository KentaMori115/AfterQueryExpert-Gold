"""Exception hierarchy for the engine.

Every error raised by :mod:`veldt` derives from :class:`VeldtError`, so callers
embedding the engine can catch a single base class. The hierarchy mirrors the
phase in which a failure occurs: parsing, planning, or execution.
"""

from __future__ import annotations

from typing import Iterable, Optional, Sequence

__all__ = [
    "VeldtError",
    "ConfigurationError",
    "SchemaError",
    "ColumnNotFoundError",
    "DuplicateColumnError",
    "TypeMismatchError",
    "CastError",
    "ParseError",
    "UnexpectedTokenError",
    "PlanningError",
    "UnsupportedFeatureError",
    "ExecutionError",
    "CatalogError",
    "TableNotFoundError",
    "TableAlreadyExistsError",
    "FunctionNotFoundError",
    "DataSourceError",
]


class VeldtError(Exception):
    """Base class for every error the engine raises."""


class ConfigurationError(VeldtError):
    """Raised when engine configuration is internally inconsistent."""


class SchemaError(VeldtError):
    """Base class for schema construction and resolution failures."""


class ColumnNotFoundError(SchemaError):
    """Raised when a column reference cannot be resolved against a schema."""

    def __init__(self, name: str, available: Optional[Iterable[str]] = None) -> None:
        self.name = name
        self.available = list(available or [])
        message = f"column {name!r} not found"
        if self.available:
            suggestion = _closest_match(name, self.available)
            if suggestion is not None:
                message += f"; did you mean {suggestion!r}?"
            else:
                message += f"; available columns: {', '.join(sorted(self.available))}"
        super().__init__(message)


class DuplicateColumnError(SchemaError):
    """Raised when a schema would contain two columns with the same name."""

    def __init__(self, name: str) -> None:
        self.name = name
        super().__init__(f"duplicate column name {name!r}")


class TypeMismatchError(SchemaError):
    """Raised when an expression is applied to incompatible operand types."""

    def __init__(self, message: str, *, operator: Optional[str] = None) -> None:
        self.operator = operator
        super().__init__(message)


class CastError(VeldtError):
    """Raised when a value cannot be converted to the requested type."""

    def __init__(self, value: object, target: str) -> None:
        self.value = value
        self.target = target
        super().__init__(f"cannot cast {value!r} to {target}")


class ParseError(VeldtError):
    """Raised for malformed expression or statement text.

    The error carries the offset of the offending character so front ends can
    render a caret under the problem.
    """

    def __init__(
        self,
        message: str,
        *,
        position: int = -1,
        line: int = -1,
        column: int = -1,
        source: Optional[str] = None,
    ) -> None:
        self.message = message
        self.position = position
        self.line = line
        self.column = column
        self.source = source
        super().__init__(self._render())

    def _render(self) -> str:
        if self.line >= 0 and self.column >= 0:
            return f"{self.message} (line {self.line}, column {self.column})"
        return self.message

    def annotated_source(self) -> str:
        """Return the offending source line with a caret under the position."""
        if not self.source or self.line < 1:
            return self.message
        lines = self.source.splitlines()
        if self.line > len(lines):
            return self.message
        offending = lines[self.line - 1]
        caret = " " * max(self.column - 1, 0) + "^"
        return f"{offending}\n{caret}\n{self.message}"


class UnexpectedTokenError(ParseError):
    """Raised when the parser sees a token it cannot use in that position."""

    def __init__(
        self,
        found: str,
        expected: Optional[Sequence[str]] = None,
        *,
        position: int = -1,
        line: int = -1,
        column: int = -1,
        source: Optional[str] = None,
    ) -> None:
        self.found = found
        self.expected = list(expected or [])
        if self.expected:
            wanted = " or ".join(repr(item) for item in self.expected)
            message = f"unexpected {found!r}, expected {wanted}"
        else:
            message = f"unexpected {found!r}"
        super().__init__(message, position=position, line=line, column=column, source=source)


class PlanningError(VeldtError):
    """Raised when a syntactically valid query cannot be turned into a plan."""


class UnsupportedFeatureError(PlanningError):
    """Raised for SQL the engine parses but deliberately does not implement."""

    def __init__(self, feature: str) -> None:
        self.feature = feature
        super().__init__(f"unsupported feature: {feature}")


class ExecutionError(VeldtError):
    """Raised when an operator fails while producing batches."""


class CatalogError(VeldtError):
    """Base class for catalog lookup and registration failures."""


class TableNotFoundError(CatalogError):
    """Raised when a query references a table that is not registered."""

    def __init__(self, name: str, available: Optional[Iterable[str]] = None) -> None:
        self.name = name
        self.available = list(available or [])
        message = f"table {name!r} is not registered"
        if self.available:
            suggestion = _closest_match(name, self.available)
            if suggestion is not None:
                message += f"; did you mean {suggestion!r}?"
            else:
                message += f"; known tables: {', '.join(sorted(self.available))}"
        super().__init__(message)


class TableAlreadyExistsError(CatalogError):
    """Raised when registering over an existing name without ``replace``."""

    def __init__(self, name: str) -> None:
        self.name = name
        super().__init__(f"table {name!r} is already registered")


class FunctionNotFoundError(VeldtError):
    """Raised when an expression calls an unknown scalar or aggregate."""

    def __init__(self, name: str, available: Optional[Iterable[str]] = None) -> None:
        self.name = name
        self.available = list(available or [])
        message = f"unknown function {name!r}"
        if self.available:
            suggestion = _closest_match(name, self.available)
            if suggestion is not None:
                message += f"; did you mean {suggestion!r}?"
        super().__init__(message)


class DataSourceError(VeldtError):
    """Raised when a data source cannot be opened or scanned."""


def _closest_match(name: str, candidates: Iterable[str]) -> Optional[str]:
    """Return the candidate closest to ``name``, ignoring case.

    A tiny edit-distance helper lives here rather than in :mod:`veldt.utils`
    because the error module must not import anything from the engine.
    """
    lowered = name.lower()
    best: Optional[str] = None
    best_score = -1
    for candidate in candidates:
        score = _similarity(lowered, candidate.lower())
        if score > best_score:
            best_score, best = score, candidate
    if best is None or best_score < 0.6:
        return None
    return best


def _similarity(left: str, right: str) -> float:
    """Return a crude 0..1 similarity ratio between two strings."""
    if not left or not right:
        return 0.0
    if left == right:
        return 1.0
    shared = 0
    remaining = list(right)
    for char in left:
        if char in remaining:
            remaining.remove(char)
            shared += 1
    return (2.0 * shared) / (len(left) + len(right))
