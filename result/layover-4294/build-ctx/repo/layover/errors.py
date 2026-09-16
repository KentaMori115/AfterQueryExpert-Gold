"""Failures raised by layover, each with a stable code and a place.

Every error in the package derives from :class:`LayoverError` and carries a
short code that does not change between releases, so a caller can branch on the
code rather than on the message text. Errors that come from reading a feed also
carry a :class:`Location` naming the table, row and field at fault.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

__all__ = [
    "CliError",
    "DocumentError",
    "FareError",
    "FeedError",
    "LayoverError",
    "Location",
    "NetworkError",
    "PlanError",
    "ServiceError",
    "TimeFormatError",
    "code_of",
    "describe",
    "known_codes",
]


@dataclass(frozen=True, order=True)
class Location:
    """Where in a feed a problem was found.

    ``row`` is one-based and counts data rows, not physical lines, so it matches
    what a spreadsheet shows once the header is hidden. A location with no row
    points at the table as a whole.
    """

    table: str
    row: Optional[int] = None
    field: Optional[str] = None

    def __str__(self) -> str:
        parts = [self.table]
        if self.row is not None:
            parts.append("row %d" % self.row)
        if self.field is not None:
            parts.append("field %r" % self.field)
        return " ".join(parts)

    def with_field(self, field: str) -> "Location":
        """Return this location pointed at ``field`` of the same row."""
        return Location(self.table, self.row, field)


class LayoverError(Exception):
    """Base class for every failure the package raises."""

    code = "layover"

    def __init__(self, message: str, where: Optional[Location] = None) -> None:
        super().__init__(message)
        self.message = message
        self.where = where

    def __str__(self) -> str:
        if self.where is None:
            return self.message
        return "%s (%s)" % (self.message, self.where)


class TimeFormatError(LayoverError):
    """A clock time or duration could not be read."""

    code = "time-format"


class ServiceError(LayoverError):
    """A service calendar is contradictory or unknown."""

    code = "service"


class NetworkError(LayoverError):
    """A network could not be built, or was asked for something it lacks."""

    code = "network"


class FeedError(LayoverError):
    """A feed table is missing, malformed, or points at something absent."""

    code = "feed"


class PlanError(LayoverError):
    """A journey search was asked for something it cannot answer."""

    code = "plan"


class FareError(LayoverError):
    """A fare could not be worked out for a journey."""

    code = "fare"


class DocumentError(LayoverError):
    """A saved document is of an unknown version or is malformed."""

    code = "document"


class CliError(LayoverError):
    """The command line was used in a way it does not support."""

    code = "cli"


_CLASSES = (
    LayoverError,
    TimeFormatError,
    ServiceError,
    NetworkError,
    FeedError,
    PlanError,
    FareError,
    DocumentError,
    CliError,
)


def code_of(error: BaseException) -> str:
    """Return the stable code of ``error``, or ``"unknown"`` for a stranger."""
    code = getattr(error, "code", None)
    if isinstance(code, str):
        return code
    return "unknown"


def known_codes() -> tuple[str, ...]:
    """Return every code the package can raise, sorted."""
    return tuple(sorted({cls.code for cls in _CLASSES}))


def describe(error: BaseException) -> str:
    """Render ``error`` as ``"code: message (place)"`` for a report or a log."""
    return "%s: %s" % (code_of(error), error)
