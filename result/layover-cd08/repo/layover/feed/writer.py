"""Writing a network, its calendars and its fares back out as feed tables.

The writer is the reader's mirror: everything it emits reads back into the same
network, which is what :mod:`tests.test_feed_roundtrip` checks. Rows are written
in identifier order so two runs over the same network produce the same bytes.
"""

from __future__ import annotations

import csv
import io
import os
from typing import Dict, Iterable, List, Optional

from layover.dates import WEEKDAY_NAMES, format_date
from layover.errors import FeedError
from layover.feed.load import FeedContents
from layover.feed.tables import TABLES, table_named
from layover.geo import format_degrees
from layover.times import format_clock

__all__ = ["feed_to_text", "write_feed", "write_table"]


def write_table(name: str, rows: Iterable[dict]) -> str:
    """Render one table as comma separated text, columns in format order."""
    definition = table_named(name)
    output = io.StringIO()
    writer = csv.writer(output, lineterminator="\n")
    writer.writerow(definition.column_names())
    for row in rows:
        unknown = sorted(set(row) - set(definition.column_names()))
        if unknown:
            raise FeedError("table %r has no column %s" % (name, ", ".join(unknown)))
        writer.writerow([_field(row.get(column)) for column in definition.column_names()])
    return output.getvalue()


def _field(value) -> str:
    if value is None:
        return ""
    if value is True:
        return "1"
    if value is False:
        return "0"
    return str(value)


def feed_to_text(contents: FeedContents) -> Dict[str, str]:
    """Render a whole feed as table name to file content.

    Tables with nothing in them are left out, the way a feed on disk would leave
    the file out, except the ones the format requires.
    """
    network = contents.network
    tables: Dict[str, List[dict]] = {name: [] for name in TABLES}

    for agency in network.agencies():
        tables["agencies"].append(
            {
                "agency_id": agency.agency_id,
                "name": agency.name,
                "url": agency.url,
                "timezone": agency.timezone,
            }
        )
    for stop in network.stops():
        latitude, longitude = ("", "")
        if stop.point is not None:
            latitude = format_degrees(stop.point.lat)
            longitude = format_degrees(stop.point.lon)
        tables["stops"].append(
            {
                "stop_id": stop.stop_id,
                "name": stop.name,
                "lat": latitude,
                "lon": longitude,
                "parent": stop.parent,
                "kind": stop.kind,
                "zone": stop.zone,
                "code": stop.code,
                "platform": stop.platform,
            }
        )
    for route in network.routes():
        tables["routes"].append(
            {
                "route_id": route.route_id,
                "short_name": route.short_name,
                "long_name": route.long_name,
                "mode": route.mode,
                "agency_id": route.agency_id,
                "colour": route.colour,
            }
        )
    for pattern in network.patterns():
        tables["patterns"].append(
            {
                "pattern_id": pattern.pattern_id,
                "route_id": pattern.route_id,
                "headsign": pattern.headsign,
                "direction": pattern.direction,
            }
        )
        for index, stop_id in enumerate(pattern.stops):
            tables["pattern_stops"].append(
                {
                    "pattern_id": pattern.pattern_id,
                    "sequence": index + 1,
                    "stop_id": stop_id,
                    "pickup": pattern.pickup[index],
                    "dropoff": pattern.dropoff[index],
                }
            )
    for trip in network.trips():
        tables["trips"].append(
            {
                "trip_id": trip.trip_id,
                "pattern_id": trip.pattern_id,
                "service_id": trip.service_id,
                "headsign": trip.headsign,
                "short_name": trip.short_name,
                "block_id": trip.block_id,
            }
        )
        for index in range(len(trip)):
            tables["stop_times"].append(
                {
                    "trip_id": trip.trip_id,
                    "sequence": index + 1,
                    "arrival": format_clock(trip.arrivals[index]),
                    "departure": format_clock(trip.departures[index]),
                }
            )
    for transfer in network.transfers():
        tables["transfers"].append(
            {
                "from_stop": transfer.from_stop,
                "to_stop": transfer.to_stop,
                "seconds": transfer.seconds,
                "kind": transfer.kind,
            }
        )
    for calendar in contents.services:
        if calendar.period is not None:
            row = {
                "service_id": calendar.service_id,
                "start_date": format_date(calendar.period.start),
                "end_date": format_date(calendar.period.end),
            }
            for index, day in enumerate(WEEKDAY_NAMES):
                row[day] = bool(calendar.weekdays & (1 << index))
            tables["calendars"].append(row)
        for day in sorted(calendar.added):
            tables["calendar_dates"].append(
                {"service_id": calendar.service_id, "date": format_date(day), "exception": "add"}
            )
        for day in sorted(calendar.removed):
            tables["calendar_dates"].append(
                {"service_id": calendar.service_id, "date": format_date(day), "exception": "remove"}
            )
    if contents.fares is not None:
        for product in contents.fares.products():
            tables["fare_products"].append(
                {
                    "fare_id": product.fare_id,
                    "price": product.price.amount,
                    "currency": product.price.currency,
                    "transfers": product.transfers,
                    "window": product.window,
                    "name": product.name,
                }
            )
        for rule in contents.fares.rules():
            tables["fare_rules"].append(
                {
                    "fare_id": rule.fare_id,
                    "from_zone": rule.from_zone,
                    "to_zone": rule.to_zone,
                    "route_id": rule.route_id,
                }
            )

    written = {}
    for name, rows in tables.items():
        if not rows and not TABLES[name].required:
            continue
        written[name] = write_table(name, rows)
    return written


def write_feed(contents: FeedContents, directory: str) -> tuple[str, ...]:
    """Write a whole feed into a directory, returning the files written."""
    if os.path.exists(directory) and not os.path.isdir(directory):
        raise FeedError("%s is not a directory" % directory)
    os.makedirs(directory, exist_ok=True)
    written = []
    for name, text in sorted(feed_to_text(contents).items()):
        path = os.path.join(directory, "%s.csv" % name)
        with open(path, "w", encoding="utf-8", newline="") as handle:
            handle.write(text)
        written.append(path)
    return tuple(written)
