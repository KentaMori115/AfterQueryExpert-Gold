"""Clock times on a service day, held as whole seconds.

A service day is not a calendar day. A tram that leaves at 25:10 belongs to the
day before, after midnight, and has to sort after 23:50 of that day rather than
before 01:10 of the next one. So a time here is the number of seconds since the
start of its service day and is allowed to run past 86400. Nothing in the
package holds a time as anything else.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Iterator, Optional

from layover.errors import Location, TimeFormatError

__all__ = [
    "SECONDS_PER_DAY",
    "SECONDS_PER_HOUR",
    "SECONDS_PER_MINUTE",
    "TimeWindow",
    "day_offset",
    "format_clock",
    "format_duration",
    "format_short",
    "is_valid_clock",
    "parse_clock",
    "parse_duration",
    "round_to_minute",
    "shift_days",
    "sorted_times",
]

SECONDS_PER_MINUTE = 60
SECONDS_PER_HOUR = 3600
SECONDS_PER_DAY = 86400

_MAX_CLOCK = SECONDS_PER_DAY * 3


def parse_clock(text: str, where: Optional[Location] = None) -> int:
    """Read ``"HH:MM:SS"`` or ``"HH:MM"`` into seconds since the service day.

    Hours above 23 are the point of the format and are kept, up to three days.
    Leading spaces and a single leading zero are tolerated because feeds in the
    wild write ``" 7:05"`` as often as ``"07:05:00"``.
    """
    if not isinstance(text, str):
        raise TimeFormatError("a clock time must be text, got %r" % (text,), where)
    cleaned = text.strip()
    if not cleaned:
        raise TimeFormatError("a clock time cannot be empty", where)
    parts = cleaned.split(":")
    if len(parts) not in (2, 3):
        raise TimeFormatError("cannot read %r as a clock time" % text, where)
    numbers = []
    for index, part in enumerate(parts):
        piece = part.strip()
        if not piece or not piece.isdigit():
            raise TimeFormatError("cannot read %r as a clock time" % text, where)
        numbers.append(int(piece))
    hours, minutes = numbers[0], numbers[1]
    seconds = numbers[2] if len(numbers) == 3 else 0
    if minutes > 59:
        raise TimeFormatError("%r has more than 59 minutes" % text, where)
    if seconds > 59:
        raise TimeFormatError("%r has more than 59 seconds" % text, where)
    total = hours * SECONDS_PER_HOUR + minutes * SECONDS_PER_MINUTE + seconds
    if total > _MAX_CLOCK:
        raise TimeFormatError("%r is more than three days out" % text, where)
    return total


def is_valid_clock(text: str) -> bool:
    """Return whether :func:`parse_clock` would accept ``text``."""
    try:
        parse_clock(text)
    except TimeFormatError:
        return False
    return True


def format_clock(seconds: int) -> str:
    """Render seconds since the service day as ``"HH:MM:SS"``, hours uncapped."""
    if seconds < 0:
        raise TimeFormatError("a clock time cannot be negative: %d" % seconds)
    hours, rest = divmod(int(seconds), SECONDS_PER_HOUR)
    minutes, secs = divmod(rest, SECONDS_PER_MINUTE)
    return "%02d:%02d:%02d" % (hours, minutes, secs)


def format_short(seconds: int) -> str:
    """Render seconds as ``"HH:MM"``, dropping the seconds a board never shows."""
    if seconds < 0:
        raise TimeFormatError("a clock time cannot be negative: %d" % seconds)
    hours, rest = divmod(int(seconds), SECONDS_PER_HOUR)
    return "%02d:%02d" % (hours, rest // SECONDS_PER_MINUTE)


def parse_duration(text: str, where: Optional[Location] = None) -> int:
    """Read ``"90"``, ``"5m"``, ``"1h30m"`` or ``"2m15s"`` into seconds.

    A bare number is minutes, which is what a feed means when it writes a
    minimum transfer time without a unit.
    """
    if not isinstance(text, str):
        raise TimeFormatError("a duration must be text, got %r" % (text,), where)
    cleaned = text.strip().lower().replace(" ", "")
    if not cleaned:
        raise TimeFormatError("a duration cannot be empty", where)
    if cleaned.isdigit():
        return int(cleaned) * SECONDS_PER_MINUTE
    units = {"h": SECONDS_PER_HOUR, "m": SECONDS_PER_MINUTE, "s": 1}
    total = 0
    digits = ""
    seen = set()
    for character in cleaned:
        if character.isdigit():
            digits += character
            continue
        if character not in units:
            raise TimeFormatError("cannot read %r as a duration" % text, where)
        if not digits:
            raise TimeFormatError("%r has a unit with no number" % text, where)
        if character in seen:
            raise TimeFormatError("%r repeats the unit %r" % (text, character), where)
        seen.add(character)
        total += int(digits) * units[character]
        digits = ""
    if digits:
        raise TimeFormatError("%r ends with a number and no unit" % text, where)
    return total


def format_duration(seconds: int) -> str:
    """Render a length of time as ``"1h30m"``, ``"45m"`` or ``"30s"``."""
    if seconds < 0:
        raise TimeFormatError("a duration cannot be negative: %d" % seconds)
    seconds = int(seconds)
    if seconds == 0:
        return "0m"
    hours, rest = divmod(seconds, SECONDS_PER_HOUR)
    minutes, secs = divmod(rest, SECONDS_PER_MINUTE)
    out = ""
    if hours:
        out += "%dh" % hours
    if minutes:
        out += "%dm" % minutes
    if secs:
        out += "%ds" % secs
    return out


def day_offset(seconds: int) -> tuple[int, int]:
    """Split a service time into whole days past midnight and the rest."""
    days, rest = divmod(int(seconds), SECONDS_PER_DAY)
    return days, rest


def shift_days(seconds: int, days: int) -> int:
    """Move a service time ``days`` whole days later, or earlier if negative."""
    moved = int(seconds) + days * SECONDS_PER_DAY
    if moved < 0:
        raise TimeFormatError("shifting %d by %d days goes before the day" % (seconds, days))
    return moved


def round_to_minute(seconds: int) -> int:
    """Round a service time to the nearest whole minute, halves going up."""
    minutes, rest = divmod(int(seconds), SECONDS_PER_MINUTE)
    if rest * 2 >= SECONDS_PER_MINUTE:
        minutes += 1
    return minutes * SECONDS_PER_MINUTE


def sorted_times(times: Iterable[int]) -> tuple[int, ...]:
    """Return the times in order, which is plain integer order by construction."""
    return tuple(sorted(int(value) for value in times))


@dataclass(frozen=True, order=True)
class TimeWindow:
    """A half-open span of service time, ``start`` included and ``end`` not.

    A window with equal ends is empty and contains nothing, which keeps the
    arithmetic below from special-casing the boundary.
    """

    start: int
    end: int

    def __post_init__(self) -> None:
        if self.end < self.start:
            raise TimeFormatError(
                "a window ends before it starts: %d to %d" % (self.start, self.end)
            )

    @property
    def length(self) -> int:
        """How long the window runs, in seconds."""
        return self.end - self.start

    @property
    def empty(self) -> bool:
        """Whether the window holds no time at all."""
        return self.end == self.start

    def contains(self, moment: int) -> bool:
        """Whether ``moment`` falls inside the window."""
        return self.start <= moment < self.end

    def overlaps(self, other: "TimeWindow") -> bool:
        """Whether two windows share any moment."""
        return self.start < other.end and other.start < self.end

    def clip(self, other: "TimeWindow") -> "TimeWindow":
        """Return the shared part of two windows, empty if they miss."""
        start = max(self.start, other.start)
        end = min(self.end, other.end)
        if end < start:
            return TimeWindow(start, start)
        return TimeWindow(start, end)

    def widen(self, before: int = 0, after: int = 0) -> "TimeWindow":
        """Return the window stretched by ``before`` and ``after`` seconds."""
        return TimeWindow(max(0, self.start - before), self.end + after)

    def shift(self, seconds: int) -> "TimeWindow":
        """Return the window moved later by ``seconds``."""
        return TimeWindow(self.start + seconds, self.end + seconds)

    def minutes(self, step: int = SECONDS_PER_MINUTE) -> Iterator[int]:
        """Walk the window in ``step`` second jumps from its start."""
        if step <= 0:
            raise TimeFormatError("a step has to move forward, got %d" % step)
        moment = self.start
        while moment < self.end:
            yield moment
            moment += step

    def __str__(self) -> str:
        return "%s-%s" % (format_short(self.start), format_short(self.end))

    @classmethod
    def of_day(cls, day: int = 0) -> "TimeWindow":
        """Return the window covering the whole of service day ``day``."""
        start = day * SECONDS_PER_DAY
        return cls(start, start + SECONDS_PER_DAY)

    @classmethod
    def parse(cls, text: str) -> "TimeWindow":
        """Read ``"07:00-09:30"`` into a window."""
        if "-" not in text:
            raise TimeFormatError("a window looks like 07:00-09:30, got %r" % text)
        start, _, end = text.partition("-")
        return cls(parse_clock(start), parse_clock(end))
