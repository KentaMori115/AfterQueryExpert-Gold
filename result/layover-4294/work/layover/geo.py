"""Positions on the ground, held as whole microdegrees.

Coordinates arrive in a feed as decimal degrees and are rounded once, on the way
in, to millionths of a degree: about eleven centimetres, far finer than a stop
is known to. Keeping them as integers means two feeds that write the same stop
the same way compare equal, and a saved document round trips exactly.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Iterable, Optional

from layover.errors import FeedError, Location

__all__ = [
    "BoundingBox",
    "EARTH_RADIUS_METRES",
    "MICRO",
    "Point",
    "centre_of",
    "distance_metres",
    "format_degrees",
    "parse_degrees",
    "walk_seconds",
]

MICRO = 1_000_000
EARTH_RADIUS_METRES = 6_371_000


def parse_degrees(text, where: Optional[Location] = None) -> int:
    """Read decimal degrees into microdegrees, rounding halves away from zero."""
    if isinstance(text, int):
        value = Decimal(text)
    elif isinstance(text, Decimal):
        value = text
    elif isinstance(text, str):
        cleaned = text.strip()
        if not cleaned:
            raise FeedError("a coordinate cannot be empty", where)
        try:
            value = Decimal(cleaned)
        except InvalidOperation:
            raise FeedError("cannot read %r as a coordinate" % text, where) from None
    else:
        raise FeedError("a coordinate must be text or a number, got %r" % (text,), where)
    scaled = value * MICRO
    whole = int(scaled)
    remainder = abs(scaled - whole)
    if remainder * 2 >= 1:
        whole += 1 if scaled >= 0 else -1
    return whole


def format_degrees(microdegrees: int) -> str:
    """Render microdegrees as decimal degrees, always to six places.

    A feed written twice from the same network has to come out byte for byte
    the same, so the trailing zeros stay rather than being trimmed.
    """
    return str((Decimal(int(microdegrees)) / MICRO).quantize(Decimal("0.000001")))


@dataclass(frozen=True, order=True)
class Point:
    """A position, latitude and longitude in microdegrees."""

    lat: int
    lon: int

    def __post_init__(self) -> None:
        if not -90 * MICRO <= self.lat <= 90 * MICRO:
            raise FeedError("a latitude is between -90 and 90, got %s" % self.degrees()[0])
        if not -180 * MICRO <= self.lon <= 180 * MICRO:
            raise FeedError("a longitude is between -180 and 180, got %s" % self.degrees()[1])

    def degrees(self) -> tuple[Decimal, Decimal]:
        """Return the position back in decimal degrees, exactly."""
        return (Decimal(self.lat) / MICRO, Decimal(self.lon) / MICRO)

    def __str__(self) -> str:
        lat, lon = self.degrees()
        return "%s,%s" % (lat, lon)

    def moved(self, north_metres: int = 0, east_metres: int = 0) -> "Point":
        """Return a position offset by whole metres, flat earth over short hops."""
        lat_delta = north_metres / EARTH_RADIUS_METRES * 180 / math.pi
        scale = math.cos(math.radians(self.lat / MICRO)) or 1e-9
        lon_delta = east_metres / (EARTH_RADIUS_METRES * scale) * 180 / math.pi
        return Point(self.lat + round(lat_delta * MICRO), self.lon + round(lon_delta * MICRO))

    @classmethod
    def of(cls, lat, lon, where: Optional[Location] = None) -> "Point":
        """Build a position from decimal degrees written any of the accepted ways."""
        return cls(parse_degrees(lat, where), parse_degrees(lon, where))

    @classmethod
    def parse(cls, text: str, where: Optional[Location] = None) -> "Point":
        """Read ``"52.5163,13.3777"`` into a position."""
        if "," not in str(text):
            raise FeedError("a position looks like 52.5163,13.3777, got %r" % (text,), where)
        lat, _, lon = str(text).partition(",")
        return cls.of(lat, lon, where)


def distance_metres(first: Point, second: Point) -> int:
    """Great circle distance between two positions, rounded to whole metres."""
    lat1 = math.radians(first.lat / MICRO)
    lat2 = math.radians(second.lat / MICRO)
    dlat = lat2 - lat1
    dlon = math.radians((second.lon - first.lon) / MICRO)
    haversine = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    angle = 2 * math.asin(min(1.0, math.sqrt(haversine)))
    return int(round(angle * EARTH_RADIUS_METRES))


def walk_seconds(metres: int, metres_per_hour: int = 4500) -> int:
    """How long a walk of ``metres`` takes, rounded up to the next whole second."""
    if metres < 0:
        raise FeedError("a walk cannot be a negative distance: %d" % metres)
    if metres_per_hour <= 0:
        raise FeedError("a walking speed has to be positive, got %d" % metres_per_hour)
    return -(-metres * 3600 // metres_per_hour)


def centre_of(points: Iterable[Point]) -> Point:
    """Return the midpoint of the box that holds every position given."""
    box = BoundingBox.of(points)
    return Point((box.south + box.north) // 2, (box.west + box.east) // 2)


@dataclass(frozen=True)
class BoundingBox:
    """The smallest box in microdegrees holding a set of positions."""

    south: int
    west: int
    north: int
    east: int

    def __post_init__(self) -> None:
        if self.north < self.south or self.east < self.west:
            raise FeedError("a bounding box is inside out")

    def contains(self, point: Point) -> bool:
        """Whether a position falls inside the box, edges included."""
        return self.south <= point.lat <= self.north and self.west <= point.lon <= self.east

    def expand(self, point: Point) -> "BoundingBox":
        """Return the box grown to hold one more position."""
        return BoundingBox(
            min(self.south, point.lat),
            min(self.west, point.lon),
            max(self.north, point.lat),
            max(self.east, point.lon),
        )

    def pad(self, metres: int) -> "BoundingBox":
        """Return the box grown by roughly ``metres`` on every side."""
        south_west = Point(self.south, self.west).moved(-metres, -metres)
        north_east = Point(self.north, self.east).moved(metres, metres)
        return BoundingBox(south_west.lat, south_west.lon, north_east.lat, north_east.lon)

    @property
    def width_metres(self) -> int:
        """How wide the box is at its middle latitude, in metres."""
        middle = (self.south + self.north) // 2
        return distance_metres(Point(middle, self.west), Point(middle, self.east))

    @property
    def height_metres(self) -> int:
        """How tall the box is, in metres."""
        return distance_metres(Point(self.south, self.west), Point(self.north, self.west))

    def __str__(self) -> str:
        return "%s..%s" % (Point(self.south, self.west), Point(self.north, self.east))

    @classmethod
    def of(cls, points: Iterable[Point]) -> "BoundingBox":
        """Return the box holding every position given, which cannot be empty."""
        ordered = list(points)
        if not ordered:
            raise FeedError("a bounding box needs at least one position")
        return cls(
            min(point.lat for point in ordered),
            min(point.lon for point in ordered),
            max(point.lat for point in ordered),
            max(point.lon for point in ordered),
        )
