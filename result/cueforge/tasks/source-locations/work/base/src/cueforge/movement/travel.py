"""Integer travel-time from distance and milli-units-per-second speed."""

from __future__ import annotations

from cueforge.movement.geometry import Point, distance_units


def travel_time_ms(start: Point, end: Point, speed_milli: int) -> int:
    """Return ceil(distance * 1_000_000 / speed_milli) milliseconds."""
    if speed_milli <= 0:
        raise ValueError("speed_milli must be positive")
    distance = distance_units(start, end)
    if distance == 0:
        return 0
    numerator = distance * 1_000_000
    return (numerator + speed_milli - 1) // speed_milli
