"""Timestamp and duration parsing.

The engine models ``TIMESTAMP`` values as naive :class:`datetime.datetime`
objects. Everything that turns text into one of those, or back again, lives
here so that the CSV reader, the cast rules and the ``date_part`` function all
agree on what a timestamp looks like.
"""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from typing import Optional

__all__ = [
    "parse_timestamp",
    "try_parse_timestamp",
    "format_timestamp",
    "parse_duration",
    "format_duration",
    "date_part",
    "TIMESTAMP_FORMATS",
]

TIMESTAMP_FORMATS = (
    "%Y-%m-%d %H:%M:%S.%f",
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d %H:%M",
    "%Y-%m-%dT%H:%M:%S.%f",
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%dT%H:%M",
    "%Y-%m-%d",
    "%Y/%m/%d %H:%M:%S",
    "%Y/%m/%d",
)

_DURATION_PATTERN = re.compile(
    r"^\s*(?:(?P<days>\d+(?:\.\d+)?)\s*d)?"
    r"\s*(?:(?P<hours>\d+(?:\.\d+)?)\s*h)?"
    r"\s*(?:(?P<minutes>\d+(?:\.\d+)?)\s*m(?!s))?"
    r"\s*(?:(?P<seconds>\d+(?:\.\d+)?)\s*s)?"
    r"\s*(?:(?P<millis>\d+(?:\.\d+)?)\s*ms)?\s*$",
    re.IGNORECASE,
)

_VALID_PARTS = (
    "year",
    "quarter",
    "month",
    "week",
    "day",
    "dayofweek",
    "dayofyear",
    "hour",
    "minute",
    "second",
    "millisecond",
    "epoch",
)


def try_parse_timestamp(text: str) -> Optional[datetime]:
    """Parse a timestamp, returning ``None`` instead of raising."""
    if not isinstance(text, str):
        return None
    candidate = text.strip()
    if not candidate:
        return None
    if candidate.endswith("Z"):
        candidate = candidate[:-1]
    for fmt in TIMESTAMP_FORMATS:
        try:
            return datetime.strptime(candidate, fmt)
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(candidate)
    except ValueError:
        return None


def parse_timestamp(text: str) -> datetime:
    """Parse a timestamp from any supported layout.

    Raises:
        ValueError: If the text does not match a known timestamp format.
    """
    parsed = try_parse_timestamp(text)
    if parsed is None:
        raise ValueError(f"cannot parse timestamp from {text!r}")
    return parsed


def format_timestamp(value: datetime, with_micros: bool = False) -> str:
    """Render a datetime using the engine's canonical layout."""
    if isinstance(value, datetime):
        if with_micros or value.microsecond:
            return value.strftime("%Y-%m-%d %H:%M:%S.%f")
        return value.strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(value, date):
        return value.strftime("%Y-%m-%d")
    raise TypeError(f"expected datetime, got {type(value).__name__}")


def parse_duration(text: str) -> timedelta:
    """Parse a compact duration such as ``2h30m`` or ``150ms``.

    Raises:
        ValueError: If the text contains no recognisable duration components.
    """
    match = _DURATION_PATTERN.match(text)
    if match is None or not any(match.groupdict().values()):
        raise ValueError(f"cannot parse duration from {text!r}")
    parts = {key: float(value) for key, value in match.groupdict().items() if value}
    return timedelta(
        days=parts.get("days", 0.0),
        hours=parts.get("hours", 0.0),
        minutes=parts.get("minutes", 0.0),
        seconds=parts.get("seconds", 0.0),
        milliseconds=parts.get("millis", 0.0),
    )


def format_duration(delta: timedelta) -> str:
    """Render a timedelta in the same compact form :func:`parse_duration` reads."""
    total = delta.total_seconds()
    if total < 1:
        return f"{total * 1000:.0f}ms"
    pieces = []
    days, remainder = divmod(int(total), 86400)
    hours, remainder = divmod(remainder, 3600)
    minutes, seconds = divmod(remainder, 60)
    if days:
        pieces.append(f"{days}d")
    if hours:
        pieces.append(f"{hours}h")
    if minutes:
        pieces.append(f"{minutes}m")
    if seconds or not pieces:
        pieces.append(f"{seconds}s")
    return "".join(pieces)


def date_part(part: str, value: datetime) -> int:
    """Extract a named component from a timestamp.

    Args:
        part: One of ``year``, ``quarter``, ``month``, ``week``, ``day``,
            ``dayofweek``, ``dayofyear``, ``hour``, ``minute``, ``second``,
            ``millisecond`` or ``epoch``.
        value: The timestamp to inspect.

    Raises:
        ValueError: If ``part`` is not a recognised component.
    """
    key = part.lower()
    if key not in _VALID_PARTS:
        raise ValueError(f"unknown date part {part!r}")
    if key == "year":
        return value.year
    if key == "quarter":
        return (value.month - 1) // 3 + 1
    if key == "month":
        return value.month
    if key == "week":
        return value.isocalendar()[1]
    if key == "day":
        return value.day
    if key == "dayofweek":
        return value.isoweekday()
    if key == "dayofyear":
        return value.timetuple().tm_yday
    if key == "hour":
        return value.hour
    if key == "minute":
        return value.minute
    if key == "second":
        return value.second
    if key == "millisecond":
        return value.microsecond // 1000
    return int(value.replace(tzinfo=None).timestamp())
