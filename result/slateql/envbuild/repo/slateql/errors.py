"""Exception hierarchy shared by every SlateQL subsystem.

Errors carry an optional source position so that the CLI can render a caret
pointing at the offending token.  Subsystems should raise the most specific
subclass available; catching :class:`SlateQLError` catches everything the
engine raises deliberately.
"""

from __future__ import annotations

from typing import Iterable, Optional

__all__ = [
    "SlateQLError",
    "ConfigurationError",
    "SyntaxErrorAtPosition",
    "ParseError",
    "LexError",
    "BindingError",
    "UnknownColumnError",
    "AmbiguousColumnError",
    "UnknownTableError",
    "UnknownFunctionError",
    "TypeMismatchError",
    "PlanningError",
    "OptimizerError",
    "ExecutionError",
    "StorageError",
    "SchemaError",
    "format_caret",
]


class SlateQLError(Exception):
    """Base class for all deliberate SlateQL failures."""

    def __init__(self, message: str, *, hint: Optional[str] = None) -> None:
        super().__init__(message)
        self.message = message
        self.hint = hint

    def __str__(self) -> str:  # pragma: no cover - trivial
        if self.hint:
            return f"{self.message}\nhint: {self.hint}"
        return self.message


class ConfigurationError(SlateQLError):
    """Raised when a :class:`slateql.config.SessionConfig` value is invalid."""


class SchemaError(SlateQLError):
    """Raised for malformed or contradictory schema definitions."""


class StorageError(SlateQLError):
    """Raised by data sources for unreadable or malformed input."""


class SyntaxErrorAtPosition(SlateQLError):
    """Base class for errors that can point at an offset in the query text."""

    def __init__(
        self,
        message: str,
        *,
        position: int = 0,
        line: int = 1,
        column: int = 1,
        hint: Optional[str] = None,
    ) -> None:
        super().__init__(message, hint=hint)
        self.position = position
        self.line = line
        self.column = column

    def annotate(self, source: str) -> str:
        """Return the message with a caret line pointing into ``source``."""

        return f"{self}\n{format_caret(source, self.line, self.column)}"


class LexError(SyntaxErrorAtPosition):
    """Raised when the lexer encounters a character it cannot tokenize."""


class ParseError(SyntaxErrorAtPosition):
    """Raised when the token stream does not form a valid statement."""


class BindingError(SlateQLError):
    """Raised while resolving identifiers against the catalog."""


class UnknownColumnError(BindingError):
    """Raised when a column reference matches nothing in scope."""


class AmbiguousColumnError(BindingError):
    """Raised when an unqualified column matches more than one relation."""


class UnknownTableError(BindingError):
    """Raised when a table reference is not registered in the catalog."""


class UnknownFunctionError(BindingError):
    """Raised when no registered function matches a call site."""


class TypeMismatchError(SlateQLError):
    """Raised when an expression cannot be typed under the coercion rules."""


class PlanningError(SlateQLError):
    """Raised when a logical plan cannot be lowered to physical operators."""


class OptimizerError(SlateQLError):
    """Raised when an optimizer rule produces an inconsistent plan."""


class ExecutionError(SlateQLError):
    """Raised for runtime failures such as division by zero or bad casts."""


def format_caret(source: str, line: int, column: int) -> str:
    """Render the offending source line with a caret under ``column``.

    ``line`` and ``column`` are 1-based.  Out-of-range positions degrade to an
    empty string rather than raising, because error formatting must never mask
    the original failure.
    """

    lines: Iterable[str] = source.splitlines() or [source]
    listing = list(lines)
    if line < 1 or line > len(listing):
        return ""
    text = listing[line - 1]
    caret_col = max(1, min(column, len(text) + 1))
    return f"  {text}\n  {' ' * (caret_col - 1)}^"
