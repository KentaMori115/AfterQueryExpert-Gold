"""Bringing an older document up to the current version.

Two versions came before this one and both are still readable. Version one wrote
coordinates as decimal strings and had no boarding flags; version two added the
flags and the transfers but still wrote times as clock strings. Each step below
does one of those jobs and hands on, so a version one document is migrated twice
and nobody has to write a direct path.
"""

from __future__ import annotations

from typing import Any, Callable, Dict, List

from layover.document.schema import FORMAT, VERSION, version_of
from layover.errors import DocumentError
from layover.geo import parse_degrees
from layover.times import parse_clock

__all__ = ["MIGRATIONS", "migrate", "migration_path"]


def _one_to_two(document: Dict[str, Any]) -> Dict[str, Any]:
    """Add the boarding flags, the transfers section and the fares section."""
    out = dict(document)
    patterns: List[Dict[str, Any]] = []
    for pattern in document.get("patterns") or ():
        stops = list(pattern.get("stops") or ())
        if len(stops) < 2:
            raise DocumentError("pattern %r has fewer than two stops" % pattern.get("id"))
        pickup = [True] * len(stops)
        dropoff = [True] * len(stops)
        dropoff[0] = False
        pickup[-1] = False
        moved = dict(pattern)
        moved["pickup"] = pickup
        moved["dropoff"] = dropoff
        moved.setdefault("direction", 0)
        moved.setdefault("headsign", "")
        patterns.append(moved)
    out["patterns"] = patterns
    out.setdefault("transfers", [])
    out.setdefault("agencies", [])
    out["fares"] = None
    out["version"] = 2
    return out


def _two_to_three(document: Dict[str, Any]) -> Dict[str, Any]:
    """Turn coordinates into microdegrees and clock strings into whole seconds."""
    out = dict(document)
    stops = []
    for stop in document.get("stops") or ():
        moved = dict(stop)
        for field in ("lat", "lon"):
            value = moved.get(field)
            if isinstance(value, str) and value.strip():
                moved[field] = parse_degrees(value)
            elif value == "" or value is None:
                moved[field] = None
        moved.setdefault("kind", "stop")
        stops.append(moved)
    out["stops"] = stops
    trips = []
    for trip in document.get("trips") or ():
        moved = dict(trip)
        times = moved.pop("times", None)
        if times is not None:
            arrivals, departures = [], []
            for entry in times:
                if isinstance(entry, (list, tuple)):
                    if len(entry) != 2:
                        raise DocumentError("trip %r has a call that is not a pair" % trip.get("id"))
                    arrival, departure = entry
                else:
                    arrival = departure = entry
                arrivals.append(_seconds(arrival))
                departures.append(_seconds(departure))
            moved["arrivals"] = arrivals
            moved["departures"] = departures
        else:
            moved["arrivals"] = [_seconds(value) for value in moved.get("arrivals") or ()]
            moved["departures"] = [_seconds(value) for value in moved.get("departures") or ()]
        trips.append(moved)
    out["trips"] = trips
    transfers = []
    for transfer in document.get("transfers") or ():
        moved = dict(transfer)
        moved["seconds"] = _seconds(moved.get("seconds"), minutes=False)
        moved.setdefault("kind", "walk")
        moved.setdefault("metres", None)
        transfers.append(moved)
    out["transfers"] = transfers
    out.setdefault("fares", None)
    out["version"] = 3
    return out


def _seconds(value: Any, minutes: bool = False) -> int:
    if isinstance(value, bool):
        raise DocumentError("a time cannot be a flag")
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        return parse_clock(value)
    raise DocumentError("cannot read %r as a time" % (value,))


MIGRATIONS: Dict[int, Callable[[Dict[str, Any]], Dict[str, Any]]] = {
    1: _one_to_two,
    2: _two_to_three,
}


def migration_path(version: int) -> tuple[int, ...]:
    """Which steps a document of this version has to go through."""
    if version > VERSION or version < 1:
        raise DocumentError("unknown document version: %d" % version)
    return tuple(range(version, VERSION))


def migrate(document: Dict[str, Any]) -> Dict[str, Any]:
    """Bring a document up to the current version, one step at a time."""
    version = version_of(document)
    out = document
    for step in migration_path(version):
        out = MIGRATIONS[step](out)
    out = dict(out)
    out["format"] = FORMAT
    out["version"] = VERSION
    return out
