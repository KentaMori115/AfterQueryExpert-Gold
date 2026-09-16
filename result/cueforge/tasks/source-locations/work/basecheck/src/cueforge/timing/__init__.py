"""Integer virtual-time helpers."""

from cueforge.timing.instants import INT64_MAX, INT64_MIN, Instant
from cueforge.timing.parse import parse_duration_ms, parse_int64, parse_offset_ms, parse_speed_milli

__all__ = [
    "INT64_MAX",
    "INT64_MIN",
    "Instant",
    "parse_duration_ms",
    "parse_int64",
    "parse_offset_ms",
    "parse_speed_milli",
]
