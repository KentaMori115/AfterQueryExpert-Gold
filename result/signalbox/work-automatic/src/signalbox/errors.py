"""Exception hierarchy shared by every layer of the toolkit.

Errors carry enough context to be printed against a scheme plan without the
caller having to reconstruct where the problem came from.
"""

from __future__ import annotations


class SignalboxError(Exception):
    """Base class for everything this package raises deliberately."""


class LayoutError(SignalboxError):
    """The scheme plan could not be read or does not describe a usable layout."""

    def __init__(
        self, message: str, *, source: str | None = None, line: int | None = None
    ) -> None:
        self.message = message
        self.source = source
        self.line = line
        super().__init__(str(self))

    def __str__(self) -> str:
        where = ""
        if self.source is not None:
            where = self.source
            if self.line is not None:
                where = f"{where}:{self.line}"
        return f"{where}: {self.message}" if where else self.message


class ParseError(LayoutError):
    """The layout text is not well formed."""


class DuplicateNameError(LayoutError):
    """Two objects in the same scheme claim the same identifier."""


class UnknownReferenceError(LayoutError):
    """An object refers to a name that the scheme never declares."""


class TopologyError(SignalboxError):
    """The track graph is inconsistent, for example a points end left dangling."""


class RoutingError(SignalboxError):
    """A route cannot be built or is contradictory."""


class InterlockingError(SignalboxError):
    """The interlocking data itself is unsound."""


class UnitError(SignalboxError):
    """A quantity was combined with an incompatible unit."""
