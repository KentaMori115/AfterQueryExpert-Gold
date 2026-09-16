"""Turning a loaded feed into a document."""

from __future__ import annotations

from typing import Any, Dict

from layover.dates import format_date
from layover.document.schema import FORMAT, VERSION
from layover.errors import DocumentError

__all__ = ["to_document"]


def to_document(contents) -> Dict[str, Any]:
    """Render a feed as a plain dictionary ready to be written as JSON."""
    network = contents.network
    document: Dict[str, Any] = {
        "format": FORMAT,
        "version": VERSION,
        "name": contents.name or network.name or "",
    }
    document["agencies"] = [
        {
            "id": agency.agency_id,
            "name": agency.name,
            "url": agency.url,
            "timezone": agency.timezone,
        }
        for agency in network.agencies()
    ]
    document["stops"] = [
        {
            "id": stop.stop_id,
            "name": stop.name,
            "lat": None if stop.point is None else stop.point.lat,
            "lon": None if stop.point is None else stop.point.lon,
            "parent": stop.parent,
            "kind": str(stop.kind),
            "zone": stop.zone,
            "code": stop.code,
            "platform": stop.platform,
        }
        for stop in network.stops()
    ]
    document["routes"] = [
        {
            "id": route.route_id,
            "short_name": route.short_name,
            "long_name": route.long_name,
            "mode": str(route.mode),
            "agency": route.agency_id,
            "colour": route.colour,
        }
        for route in network.routes()
    ]
    document["patterns"] = [
        {
            "id": pattern.pattern_id,
            "route": pattern.route_id,
            "stops": list(pattern.stops),
            "pickup": [bool(flag) for flag in pattern.pickup],
            "dropoff": [bool(flag) for flag in pattern.dropoff],
            "headsign": pattern.headsign,
            "direction": pattern.direction,
        }
        for pattern in network.patterns()
    ]
    document["trips"] = [
        {
            "id": trip.trip_id,
            "pattern": trip.pattern_id,
            "service": trip.service_id,
            "arrivals": list(trip.arrivals),
            "departures": list(trip.departures),
            "headsign": trip.headsign,
            "short_name": trip.short_name,
            "block": trip.block_id,
        }
        for trip in network.trips()
    ]
    document["transfers"] = [
        {
            "from": transfer.from_stop,
            "to": transfer.to_stop,
            "seconds": transfer.seconds,
            "kind": str(transfer.kind),
            "metres": transfer.distance_metres,
        }
        for transfer in network.transfers()
    ]
    document["calendars"] = [
        {
            "id": calendar.service_id,
            "weekdays": calendar.weekdays,
            "start": None if calendar.period is None else format_date(calendar.period.start),
            "end": None if calendar.period is None else format_date(calendar.period.end),
            "added": [format_date(day) for day in sorted(calendar.added)],
            "removed": [format_date(day) for day in sorted(calendar.removed)],
        }
        for calendar in contents.services
    ]
    document["fares"] = _fares(contents.fares)
    return document


def _fares(table) -> Any:
    if table is None:
        return None
    return {
        "currency": table.currency,
        "products": [
            {
                "id": product.fare_id,
                "price": str(product.price.amount),
                "transfers": product.transfers,
                "window": product.window,
                "name": product.name,
            }
            for product in table.products()
        ],
        "rules": [
            {
                "fare": rule.fare_id,
                "from": rule.from_zone,
                "to": rule.to_zone,
                "route": rule.route_id,
            }
            for rule in table.rules()
        ],
    }
