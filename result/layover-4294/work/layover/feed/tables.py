"""What the feed format looks like: its tables, columns and keys.

A feed is a directory of comma separated files, one per table, each with a
header row. The definitions here are the only place the format is written down;
the reader checks a file against them, the writer emits the columns in this
order, and the validation layer quotes them in its findings.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Optional, Tuple

from layover.errors import FeedError

__all__ = [
    "Column",
    "REQUIRED_TABLES",
    "TABLES",
    "Table",
    "table_named",
    "table_names",
]


@dataclass(frozen=True)
class Column:
    """One column of a feed table."""

    name: str
    required: bool = False
    note: str = ""

    def __str__(self) -> str:
        return self.name if self.required else "[%s]" % self.name


@dataclass(frozen=True)
class Table:
    """One feed table: its columns, which of them are the key, and whether it must exist."""

    name: str
    columns: Tuple[Column, ...]
    key: Tuple[str, ...] = ()
    required: bool = False
    note: str = ""

    def column_names(self) -> tuple[str, ...]:
        """Every column name, in the order the writer emits them."""
        return tuple(column.name for column in self.columns)

    def required_names(self) -> tuple[str, ...]:
        """The columns a file must have to be read at all."""
        return tuple(column.name for column in self.columns if column.required)

    def has_column(self, name: str) -> bool:
        """Whether the table defines a column."""
        return name in self.column_names()

    def column(self, name: str) -> Column:
        """Return one column, raising if the table does not define it."""
        for column in self.columns:
            if column.name == name:
                return column
        raise FeedError("table %r has no column %r" % (self.name, name))

    def missing_from(self, header) -> tuple[str, ...]:
        """Which required columns a header lacks."""
        present = set(header)
        return tuple(name for name in self.required_names() if name not in present)

    def unknown_in(self, header) -> tuple[str, ...]:
        """Which columns of a header the format does not define, sorted."""
        known = set(self.column_names())
        return tuple(sorted(set(header) - known))

    def __str__(self) -> str:
        return "%s(%s)" % (self.name, ", ".join(str(column) for column in self.columns))


def _table(name, columns, key=(), required=False, note=""):
    return Table(
        name,
        tuple(Column(entry[0], entry[1], entry[2] if len(entry) > 2 else "") for entry in columns),
        tuple(key),
        required,
        note,
    )


TABLES: Dict[str, Table] = {
    table.name: table
    for table in (
        _table(
            "agencies",
            [
                ("agency_id", True),
                ("name", True),
                ("url", False),
                ("timezone", False, "recorded, not interpreted"),
            ],
            key=("agency_id",),
        ),
        _table(
            "stops",
            [
                ("stop_id", True),
                ("name", True),
                ("lat", False),
                ("lon", False),
                ("parent", False),
                ("kind", False),
                ("zone", False),
                ("code", False),
                ("platform", False),
            ],
            key=("stop_id",),
            required=True,
        ),
        _table(
            "routes",
            [
                ("route_id", True),
                ("short_name", False),
                ("long_name", False),
                ("mode", False),
                ("agency_id", False),
                ("colour", False),
            ],
            key=("route_id",),
            required=True,
        ),
        _table(
            "patterns",
            [("pattern_id", True), ("route_id", True), ("headsign", False), ("direction", False)],
            key=("pattern_id",),
            required=True,
        ),
        _table(
            "pattern_stops",
            [
                ("pattern_id", True),
                ("sequence", True),
                ("stop_id", True),
                ("pickup", False),
                ("dropoff", False),
            ],
            key=("pattern_id", "sequence"),
            required=True,
        ),
        _table(
            "trips",
            [
                ("trip_id", True),
                ("pattern_id", True),
                ("service_id", True),
                ("headsign", False),
                ("short_name", False),
                ("block_id", False, "recorded, not acted on"),
            ],
            key=("trip_id",),
            required=True,
        ),
        _table(
            "stop_times",
            [("trip_id", True), ("sequence", True), ("arrival", True), ("departure", False)],
            key=("trip_id", "sequence"),
            required=True,
        ),
        _table(
            "calendars",
            [
                ("service_id", True),
                ("monday", False),
                ("tuesday", False),
                ("wednesday", False),
                ("thursday", False),
                ("friday", False),
                ("saturday", False),
                ("sunday", False),
                ("start_date", True),
                ("end_date", True),
            ],
            key=("service_id",),
        ),
        _table(
            "calendar_dates",
            [("service_id", True), ("date", True), ("exception", False, "add or remove")],
            key=("service_id", "date"),
        ),
        _table(
            "transfers",
            [("from_stop", True), ("to_stop", True), ("seconds", True), ("kind", False)],
            key=("from_stop", "to_stop"),
        ),
        _table(
            "fare_products",
            [
                ("fare_id", True),
                ("price", True),
                ("currency", False),
                ("transfers", False),
                ("window", False),
                ("name", False),
            ],
            key=("fare_id",),
        ),
        _table(
            "fare_rules",
            [("fare_id", True), ("from_zone", False), ("to_zone", False), ("route_id", False)],
        ),
        _table(
            "fare_caps",
            [
                ("cap_id", True),
                ("price", True),
                ("period", True, "day or week"),
                ("currency", False),
                ("zone", False, "the cap only covers travel inside it"),
                ("route_id", False, "the cap only covers travel on it"),
            ],
            key=("cap_id",),
        ),
    )
}

REQUIRED_TABLES: Tuple[str, ...] = tuple(
    sorted(name for name, table in TABLES.items() if table.required)
)


def table_names() -> tuple[str, ...]:
    """Every table the format defines, sorted."""
    return tuple(sorted(TABLES))


def table_named(name: str) -> Table:
    """Return one table definition, raising if the format has no such table."""
    try:
        return TABLES[name]
    except KeyError:
        raise FeedError("the feed format has no table %r" % (name,)) from None
