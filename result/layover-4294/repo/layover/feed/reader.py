"""Reading a feed directory into raw tables, before anything is interpreted.

Nothing here knows what a stop is. It reads comma separated text into rows of
strings, keeps the row numbers so a later complaint can point at the line, and
checks that the required columns are present. Everything else is
:mod:`layover.feed.load`'s problem.
"""

from __future__ import annotations

import csv
import io
import os
from dataclasses import dataclass
from typing import Dict, Iterable, Iterator, Mapping, Optional, Tuple

from layover.errors import FeedError, Location
from layover.feed.tables import REQUIRED_TABLES, TABLES, table_named

__all__ = ["RawFeed", "RawRow", "RawTable", "read_directory", "read_text"]


@dataclass(frozen=True)
class RawRow:
    """One data row: its number, and its fields as written."""

    table: str
    number: int
    values: Mapping[str, str]

    def get(self, column: str, default: str = "") -> str:
        """The field as written, or ``default`` if the column is absent or blank."""
        value = self.values.get(column)
        if value is None:
            return default
        stripped = value.strip()
        return stripped if stripped else default

    def has(self, column: str) -> bool:
        """Whether the row has anything at all in a column."""
        return bool(self.get(column))

    def where(self, column: Optional[str] = None) -> Location:
        """A location pointing at this row, and at a column if one is named."""
        return Location(self.table, self.number, column)

    def __getitem__(self, column: str) -> str:
        return self.get(column)

    def __contains__(self, column: object) -> bool:
        return column in self.values


@dataclass(frozen=True)
class RawTable:
    """One feed table as read: its header and its rows."""

    name: str
    header: Tuple[str, ...]
    rows: Tuple[RawRow, ...]

    def __len__(self) -> int:
        return len(self.rows)

    def __iter__(self) -> Iterator[RawRow]:
        return iter(self.rows)

    @property
    def is_empty(self) -> bool:
        """Whether the table has a header but no data."""
        return not self.rows

    def column(self, name: str) -> tuple[str, ...]:
        """Every value in one column, in row order."""
        return tuple(row.get(name) for row in self.rows)

    def __str__(self) -> str:
        return "%s (%d rows)" % (self.name, len(self.rows))


class RawFeed:
    """Every table of a feed, keyed by name."""

    def __init__(self, tables: Iterable[RawTable] = (), source: str = "") -> None:
        self._tables: Dict[str, RawTable] = {}
        self.source = source
        for table in tables:
            self.add(table)

    def add(self, table: RawTable) -> None:
        """Take on one table, refusing a name that is already there."""
        if table.name in self._tables:
            raise FeedError("table %r is read twice" % table.name)
        self._tables[table.name] = table

    def has(self, name: str) -> bool:
        """Whether the feed carries a table."""
        return name in self._tables

    def table(self, name: str) -> RawTable:
        """Return one table, raising if the feed does not carry it."""
        try:
            return self._tables[name]
        except KeyError:
            raise FeedError("the feed has no %r table" % (name,), Location(name)) from None

    def rows(self, name: str) -> tuple[RawRow, ...]:
        """The rows of a table, or nothing at all if the feed lacks it."""
        if name not in self._tables:
            return ()
        return self._tables[name].rows

    def names(self) -> tuple[str, ...]:
        """Every table the feed carries, sorted."""
        return tuple(sorted(self._tables))

    def missing_tables(self) -> tuple[str, ...]:
        """Which required tables the feed lacks, sorted."""
        return tuple(name for name in REQUIRED_TABLES if name not in self._tables)

    def counts(self) -> dict:
        """How many rows each table holds."""
        return {name: len(table) for name, table in sorted(self._tables.items())}

    def check(self) -> None:
        """Raise if a required table is missing or has no rows."""
        missing = self.missing_tables()
        if missing:
            raise FeedError("the feed is missing %s" % ", ".join(missing))
        if not self.has("calendars") and not self.has("calendar_dates"):
            raise FeedError("the feed has no calendars and no calendar_dates")

    def __len__(self) -> int:
        return len(self._tables)

    def __contains__(self, name: object) -> bool:
        return name in self._tables

    def __str__(self) -> str:
        return "%d tables from %s" % (len(self._tables), self.source or "text")

    @classmethod
    def of_text(cls, texts: Mapping[str, str], source: str = "") -> "RawFeed":
        """Build a feed from table name to file content, without touching a disk."""
        return cls((read_text(name, text) for name, text in sorted(texts.items())), source)


def read_text(name: str, text: str) -> RawTable:
    """Read one table from comma separated text."""
    definition = table_named(name)
    handle = io.StringIO(text.lstrip("﻿"))
    reader = csv.reader(handle)
    try:
        header = next(reader)
    except StopIteration:
        raise FeedError("table %r is empty, not even a header" % name, Location(name)) from None
    header = tuple(field.strip() for field in header)
    if len(set(header)) != len(header):
        raise FeedError("table %r repeats a column" % name, Location(name))
    missing = definition.missing_from(header)
    if missing:
        raise FeedError(
            "table %r is missing the column %s" % (name, ", ".join(missing)), Location(name)
        )
    rows = []
    number = 0
    for fields in reader:
        if not any(field.strip() for field in fields):
            continue
        number += 1
        if len(fields) != len(header):
            raise FeedError(
                "table %r has %d fields where the header has %d"
                % (name, len(fields), len(header)),
                Location(name, number),
            )
        rows.append(RawRow(name, number, dict(zip(header, fields))))
    return RawTable(name, header, tuple(rows))


def read_directory(path: str) -> RawFeed:
    """Read every table the format defines that the directory holds."""
    if not os.path.isdir(path):
        raise FeedError("no such feed directory: %s" % path)
    tables = []
    for name in sorted(TABLES):
        filename = os.path.join(path, "%s.csv" % name)
        if not os.path.isfile(filename):
            continue
        with open(filename, "r", encoding="utf-8", newline="") as handle:
            tables.append(read_text(name, handle.read()))
    feed = RawFeed(tables, path)
    if not len(feed):
        raise FeedError("directory %s holds no feed table at all" % path)
    return feed
