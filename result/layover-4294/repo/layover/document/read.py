"""Turning a document back into a loaded feed.

A document that is not current is migrated first, so a caller never has to know
which version it is holding. What comes back is the same
:class:`~layover.feed.load.FeedContents` the feed reader produces, so everything
downstream cannot tell where a network came from.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from layover.dates import DateRange, parse_date
from layover.document.migrate import migrate
from layover.document.schema import check_document, section
from layover.errors import DocumentError
from layover.fares.rules import FareProduct, FareRule
from layover.fares.table import FareTable
from layover.feed.load import FeedContents
from layover.geo import Point
from layover.money import Money
from layover.network import Agency, NetworkBuilder, Pattern, Route, Stop, Transfer, Trip
from layover.services import ServiceCalendar, ServiceRegistry

__all__ = ["from_document"]


def from_document(document: Dict[str, Any], name: str = "") -> FeedContents:
    """Read a document, migrating it first if it is an older version."""
    document = migrate(document)
    check_document(document)
    builder = NetworkBuilder(name or str(document.get("name", "")))
    for row in section(document, "agencies"):
        builder.add_agency(
            Agency(
                _text(row, "id"),
                _text(row, "name"),
                row.get("url") or "",
                row.get("timezone") or "",
            )
        )
    for row in section(document, "stops"):
        latitude, longitude = row.get("lat"), row.get("lon")
        point = None
        if latitude is not None and longitude is not None:
            point = Point(_whole(latitude, "lat"), _whole(longitude, "lon"))
        builder.add_stop(
            Stop(
                _text(row, "id"),
                _text(row, "name"),
                point,
                row.get("parent"),
                row.get("kind") or "stop",
                row.get("zone"),
                row.get("code"),
                row.get("platform"),
            )
        )
    for row in section(document, "routes"):
        builder.add_route(
            Route(
                _text(row, "id"),
                row.get("short_name") or "",
                row.get("long_name") or "",
                row.get("mode") or "bus",
                row.get("agency"),
                row.get("colour"),
            )
        )
    for row in section(document, "patterns"):
        builder.add_pattern(
            Pattern(
                _text(row, "id"),
                _text(row, "route"),
                tuple(row.get("stops") or ()),
                tuple(bool(flag) for flag in row.get("pickup") or ()),
                tuple(bool(flag) for flag in row.get("dropoff") or ()),
                row.get("headsign") or "",
                int(row.get("direction") or 0),
            )
        )
    for row in section(document, "trips"):
        builder.add_trip(
            Trip(
                _text(row, "id"),
                _text(row, "pattern"),
                _text(row, "service"),
                tuple(_whole(value, "arrival") for value in row.get("arrivals") or ()),
                tuple(_whole(value, "departure") for value in row.get("departures") or ()),
                row.get("headsign") or "",
                row.get("short_name") or "",
                row.get("block"),
            )
        )
    for row in section(document, "transfers"):
        builder.add_transfer(
            Transfer(
                _text(row, "from"),
                _text(row, "to"),
                _whole(row.get("seconds"), "seconds"),
                row.get("kind") or "walk",
                row.get("metres"),
            )
        )
    registry = ServiceRegistry()
    for row in section(document, "calendars"):
        period = None
        if row.get("start") and row.get("end"):
            period = DateRange(parse_date(row["start"]), parse_date(row["end"]))
        registry.add(
            ServiceCalendar(
                _text(row, "id"),
                _whole(row.get("weekdays", 0), "weekdays"),
                period,
                frozenset(parse_date(day) for day in row.get("added") or ()),
                frozenset(parse_date(day) for day in row.get("removed") or ()),
            )
        )
    return FeedContents(
        builder.build(),
        registry,
        _fares(document.get("fares")),
        name or str(document.get("name", "")),
    )


def _fares(fares) -> Optional[FareTable]:
    if fares is None:
        return None
    if not isinstance(fares, dict):
        raise DocumentError("the fares section is not a mapping")
    currency = fares.get("currency") or "EUR"
    table = FareTable(currency=currency)
    for row in fares.get("products") or ():
        table.add_product(
            FareProduct(
                _text(row, "id"),
                Money(row.get("price"), currency),
                row.get("transfers"),
                row.get("window"),
                row.get("name") or "",
            )
        )
    for row in fares.get("rules") or ():
        table.add_rule(
            FareRule(_text(row, "fare"), row.get("from"), row.get("to"), row.get("route"))
        )
    return table


def _text(row: Dict[str, Any], key: str) -> str:
    value = row.get(key)
    if not isinstance(value, str) or not value.strip():
        raise DocumentError("a row is missing %r" % key)
    return value


def _whole(value: Any, what: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise DocumentError("%s has to be a whole number, got %r" % (what, value))
    return value
