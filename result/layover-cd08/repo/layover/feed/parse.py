"""Turning the strings a feed writes into the values the engine holds.

Every reader takes the field, the place it came from and a collector. A field it
cannot read becomes a problem in the collector and a fallback value, so one bad
row does not stop the reader finding the other four hundred. A caller that wants
the first failure to be fatal asks the collector to raise.
"""

from __future__ import annotations

from datetime import date
from typing import Callable, Iterable, List, Optional

from layover.dates import parse_date
from layover.errors import FeedError, LayoverError, Location
from layover.times import parse_clock

__all__ = ["Problems", "RowReader", "read_boolean", "read_integer"]

_TRUE = ("1", "true", "yes", "y", "t")
_FALSE = ("0", "false", "no", "n", "f", "")


def read_boolean(text: str, where: Optional[Location] = None) -> bool:
    """Read the several ways a feed writes a flag."""
    cleaned = str(text).strip().lower()
    if cleaned in _TRUE:
        return True
    if cleaned in _FALSE:
        return False
    raise FeedError("cannot read %r as a yes or no" % (text,), where)


def read_integer(text: str, where: Optional[Location] = None) -> int:
    """Read a whole number, refusing anything with a point in it."""
    cleaned = str(text).strip()
    if not cleaned:
        raise FeedError("a whole number cannot be empty", where)
    negative = cleaned.startswith("-")
    digits = cleaned[1:] if negative else cleaned
    if not digits.isdigit():
        raise FeedError("cannot read %r as a whole number" % (text,), where)
    return -int(digits) if negative else int(digits)


class Problems:
    """Collects what went wrong while a feed was read."""

    def __init__(self, limit: Optional[int] = None) -> None:
        self._found: List[LayoverError] = []
        self.limit = limit

    def add(self, problem: LayoverError) -> None:
        """Record one failure, raising once the limit is passed."""
        self._found.append(problem)
        if self.limit is not None and len(self._found) > self.limit:
            first = self._found[0]
            raise FeedError(
                "gave up after %d problems, the first is: %s"
                % (len(self._found), first.message if isinstance(first, LayoverError) else first)
            )

    def note(self, message: str, where: Optional[Location] = None) -> None:
        """Record a failure from a message rather than an exception."""
        self.add(FeedError(message, where))

    def __len__(self) -> int:
        return len(self._found)

    def __iter__(self):
        return iter(self._found)

    def __bool__(self) -> bool:
        return bool(self._found)

    @property
    def found(self) -> tuple[LayoverError, ...]:
        """Everything recorded, in the order it was found."""
        return tuple(self._found)

    def messages(self) -> tuple[str, ...]:
        """Every problem as text, in the order it was found."""
        return tuple(str(problem) for problem in self._found)

    def raise_if_any(self) -> None:
        """Raise the first problem, saying how many followed it."""
        if not self._found:
            return
        first = self._found[0]
        if len(self._found) == 1:
            raise first
        summary = first.message if isinstance(first, LayoverError) else str(first)
        raise FeedError(
            "%d problems reading the feed, the first is: %s" % (len(self._found), summary),
            getattr(first, "where", None),
        )

    def __str__(self) -> str:
        return "%d problems" % len(self._found)


class RowReader:
    """Reads the fields of one row, sending failures to a collector."""

    def __init__(self, row, problems: Problems) -> None:
        self.row = row
        self.problems = problems
        self.failed = False

    def _fail(self, problem: LayoverError, fallback):
        self.failed = True
        self.problems.add(problem)
        return fallback

    def text(self, column: str, fallback: str = "") -> str:
        """A field that has to be there."""
        value = self.row.get(column)
        if not value:
            return self._fail(
                FeedError("%r is missing" % column, self.row.where(column)), fallback
            )
        return value

    def optional_text(self, column: str, fallback: Optional[str] = None) -> Optional[str]:
        """A field that may be blank."""
        return self.row.get(column) or fallback

    def integer(self, column: str, fallback: int = 0) -> int:
        """A whole number that has to be there."""
        value = self.row.get(column)
        if not value:
            return self._fail(
                FeedError("%r is missing" % column, self.row.where(column)), fallback
            )
        try:
            return read_integer(value, self.row.where(column))
        except LayoverError as problem:
            return self._fail(problem, fallback)

    def optional_integer(self, column: str, fallback: Optional[int] = None) -> Optional[int]:
        """A whole number that may be blank."""
        value = self.row.get(column)
        if not value:
            return fallback
        try:
            return read_integer(value, self.row.where(column))
        except LayoverError as problem:
            return self._fail(problem, fallback)

    def boolean(self, column: str, fallback: bool = True) -> bool:
        """A flag that falls back when the column is blank."""
        value = self.row.get(column)
        if not value:
            return fallback
        try:
            return read_boolean(value, self.row.where(column))
        except LayoverError as problem:
            return self._fail(problem, fallback)

    def clock(self, column: str, fallback: int = 0) -> int:
        """A clock time that has to be there."""
        value = self.row.get(column)
        if not value:
            return self._fail(
                FeedError("%r is missing" % column, self.row.where(column)), fallback
            )
        try:
            return parse_clock(value, self.row.where(column))
        except LayoverError as problem:
            return self._fail(problem, fallback)

    def optional_clock(self, column: str, fallback: Optional[int] = None) -> Optional[int]:
        """A clock time that may be blank."""
        value = self.row.get(column)
        if not value:
            return fallback
        try:
            return parse_clock(value, self.row.where(column))
        except LayoverError as problem:
            return self._fail(problem, fallback)

    def date(self, column: str, fallback: Optional[date] = None) -> Optional[date]:
        """A calendar date that has to be there."""
        value = self.row.get(column)
        if not value:
            return self._fail(
                FeedError("%r is missing" % column, self.row.where(column)), fallback
            )
        try:
            return parse_date(value, self.row.where(column))
        except LayoverError as problem:
            return self._fail(problem, fallback)

    def choice(self, column: str, allowed: Iterable[str], fallback: str) -> str:
        """A field that has to be one of a short list of words."""
        value = self.row.get(column)
        if not value:
            return fallback
        cleaned = value.strip().lower()
        options = tuple(allowed)
        if cleaned not in options:
            return self._fail(
                FeedError(
                    "%r is %r, which is not one of %s" % (column, value, ", ".join(options)),
                    self.row.where(column),
                ),
                fallback,
            )
        return cleaned

    def built(self, build: Callable, *args, **kwargs):
        """Build a value, sending a failure to the collector instead of raising."""
        try:
            return build(*args, **kwargs)
        except LayoverError as problem:
            if problem.where is None:
                problem.where = self.row.where()
            return self._fail(problem, None)
