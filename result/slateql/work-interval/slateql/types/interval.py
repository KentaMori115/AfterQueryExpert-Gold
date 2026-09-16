"""The INTERVAL value type.

An interval is a span of time held as three independent fields: a count of
months, a count of days, and a count of microseconds.  The fields never fold
into each other, because a month has no fixed length and a day is not always
24 hours once a calendar is involved.  Adding an interval to a date walks the
calendar one field at a time, so ``2024-01-31 + P1M`` lands on the last day of
February rather than overflowing into March.

Comparison is a different question from arithmetic.  Sorting, grouping and
``=`` need a total order, so for those purposes a month counts as 30 days and
a day as 24 hours: ``P1M`` and ``P30D`` compare equal and land in the same
group even though adding them to a date can give different answers.

Text form is the ISO 8601 duration syntax, ``P1Y2M3DT4H5M6S``.  Years fold
into months and weeks into days on the way in; hours and minutes fold into
seconds.  Every component carries its own sign, and a component that is zero
is left out, so a zero interval renders as ``PT0S``.
"""

from __future__ import annotations

import calendar
import datetime as dt
import re
from fractions import Fraction
from typing import Any, Union

__all__ = [
    "Interval",
    "DAYS_PER_MONTH",
    "SECONDS_PER_DAY",
    "MICROS_PER_SECOND",
    "parse_interval",
    "format_interval",
    "add_to_temporal",
    "subtract_temporal",
    "interval_field",
    "INTERVAL_UNITS",
]

DAYS_PER_MONTH = 30
SECONDS_PER_DAY = 86_400
MICROS_PER_SECOND = 1_000_000
_MICROS_PER_MINUTE = 60 * MICROS_PER_SECOND
_MICROS_PER_HOUR = 60 * _MICROS_PER_MINUTE
_MICROS_PER_DAY = SECONDS_PER_DAY * MICROS_PER_SECOND

# Units accepted after a quoted integer in ``INTERVAL '3' DAY``, each mapped to
# the field it fills and the multiplier that gets it there.
INTERVAL_UNITS: dict[str, tuple[str, int]] = {
    "YEAR": ("months", 12),
    "MONTH": ("months", 1),
    "WEEK": ("days", 7),
    "DAY": ("days", 1),
    "HOUR": ("micros", _MICROS_PER_HOUR),
    "MINUTE": ("micros", _MICROS_PER_MINUTE),
    "SECOND": ("micros", MICROS_PER_SECOND),
}

_ISO_DURATION = re.compile(
    r"""
    ^(?P<sign>[+-])?P
    (?:(?P<years>[+-]?\d+)Y)?
    (?:(?P<months>[+-]?\d+)M)?
    (?:(?P<weeks>[+-]?\d+)W)?
    (?:(?P<days>[+-]?\d+)D)?
    (?:(?P<time>T)
        (?:(?P<hours>[+-]?\d+)H)?
        (?:(?P<minutes>[+-]?\d+)M)?
        (?:(?P<seconds>[+-]?\d+(?:\.\d+)?)S)?
    )?$
    """,
    re.VERBOSE | re.IGNORECASE,
)

Number = Union[int, float, Fraction]


def _truncate(value: Fraction) -> int:
    """Integer part of ``value``, rounding toward zero like a C cast."""

    return int(value) if value >= 0 else -int(-value)


def _split(total: int, unit: int) -> tuple[int, int]:
    """Split ``total`` into whole units and a remainder, both keeping its sign."""

    whole = abs(total) // unit
    rest = abs(total) - whole * unit
    if total < 0:
        return -whole, -rest
    return whole, rest


class Interval:
    """A calendar-aware span of time: months, days and microseconds."""

    __slots__ = ("months", "days", "micros")

    def __init__(self, months: int = 0, days: int = 0, micros: int = 0) -> None:
        for name, value in (("months", months), ("days", days), ("micros", micros)):
            if isinstance(value, bool) or not isinstance(value, int):
                raise TypeError(f"Interval {name} must be an int, got {type(value).__name__}")
        self.months = months
        self.days = days
        self.micros = micros

    # -- construction ------------------------------------------------------

    @classmethod
    def from_timedelta(cls, delta: dt.timedelta) -> "Interval":
        """Convert a :class:`datetime.timedelta`; it never carries months.

        Python normalises ``timedelta(hours=-2)`` to a day of ``-1`` and
        ``79200`` seconds; here the total is split again into whole days
        truncated toward zero and the remaining microseconds, so it becomes
        ``PT-2H``, the same shape a timestamp difference produces.
        """

        total = (delta.days * SECONDS_PER_DAY + delta.seconds) * MICROS_PER_SECOND
        total += delta.microseconds
        days, micros = _split(total, _MICROS_PER_DAY)
        return cls(0, days, micros)

    @classmethod
    def parse(cls, text: str) -> "Interval":
        """Parse ISO 8601 duration text; :class:`ValueError` on anything else."""

        return parse_interval(text)

    @classmethod
    def of_unit(cls, quantity: int, unit: str) -> "Interval":
        """Build from a whole ``quantity`` of one ``unit`` (``YEAR`` .. ``SECOND``)."""

        try:
            field, factor = INTERVAL_UNITS[unit.strip().upper()]
        except KeyError:
            raise ValueError(f"unknown interval unit {unit!r}") from None
        return cls(**{field: quantity * factor})

    # -- ordering and identity ---------------------------------------------

    def normalised(self) -> int:
        """The comparison value: total microseconds at 30-day months and 24-hour days."""

        return (self.months * DAYS_PER_MONTH + self.days) * _MICROS_PER_DAY + self.micros

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, Interval):
            return NotImplemented
        return self.normalised() == other.normalised()

    def __ne__(self, other: object) -> bool:
        if not isinstance(other, Interval):
            return NotImplemented
        return self.normalised() != other.normalised()

    def __hash__(self) -> int:
        return hash(("interval", self.normalised()))

    def __lt__(self, other: "Interval") -> bool:
        if not isinstance(other, Interval):
            return NotImplemented
        return self.normalised() < other.normalised()

    def __le__(self, other: "Interval") -> bool:
        if not isinstance(other, Interval):
            return NotImplemented
        return self.normalised() <= other.normalised()

    def __gt__(self, other: "Interval") -> bool:
        if not isinstance(other, Interval):
            return NotImplemented
        return self.normalised() > other.normalised()

    def __ge__(self, other: "Interval") -> bool:
        if not isinstance(other, Interval):
            return NotImplemented
        return self.normalised() >= other.normalised()

    def __bool__(self) -> bool:
        return bool(self.months or self.days or self.micros)

    # -- arithmetic --------------------------------------------------------

    def __neg__(self) -> "Interval":
        return Interval(-self.months, -self.days, -self.micros)

    def __pos__(self) -> "Interval":
        return self

    def __abs__(self) -> "Interval":
        return -self if self.normalised() < 0 else self

    def __add__(self, other: Any) -> Any:
        if isinstance(other, Interval):
            return Interval(
                self.months + other.months,
                self.days + other.days,
                self.micros + other.micros,
            )
        if isinstance(other, dt.date):
            return add_to_temporal(other, self)
        return NotImplemented

    def __radd__(self, other: Any) -> Any:
        if isinstance(other, dt.date):
            return add_to_temporal(other, self)
        return NotImplemented

    def __sub__(self, other: Any) -> Any:
        if isinstance(other, Interval):
            return self + (-other)
        return NotImplemented

    def __rsub__(self, other: Any) -> Any:
        if isinstance(other, dt.date):
            return add_to_temporal(other, -self)
        return NotImplemented

    def __mul__(self, factor: Any) -> Any:
        if isinstance(factor, bool) or not isinstance(factor, (int, float, Fraction)):
            return NotImplemented
        return self.scale(_as_fraction(factor))

    __rmul__ = __mul__

    def __truediv__(self, divisor: Any) -> Any:
        if isinstance(divisor, bool) or not isinstance(divisor, (int, float, Fraction)):
            return NotImplemented
        if divisor == 0:
            raise ZeroDivisionError("interval division by zero")
        return self.scale(1 / _as_fraction(divisor))

    def scale(self, factor: Fraction) -> "Interval":
        """Multiply every field by ``factor``, carrying fractions downward.

        Whole months and whole days are kept; a fractional month becomes days
        at 30 per month and a fractional day becomes microseconds at 86400
        seconds per day.  The microsecond total is rounded to the nearest
        whole microsecond.
        """

        months_exact = self.months * factor
        months = _truncate(months_exact)
        days_exact = self.days * factor + (months_exact - months) * DAYS_PER_MONTH
        days = _truncate(days_exact)
        micros_exact = self.micros * factor + (days_exact - days) * _MICROS_PER_DAY
        return Interval(months, days, round(micros_exact))

    # -- rendering ---------------------------------------------------------

    def __str__(self) -> str:
        return format_interval(self)

    def __repr__(self) -> str:
        return f"Interval({format_interval(self)!r})"

    def to_timedelta(self) -> dt.timedelta:
        """The day and time fields as a timedelta; months count as 30 days."""

        return dt.timedelta(
            days=self.months * DAYS_PER_MONTH + self.days, microseconds=self.micros
        )


def _as_fraction(number: Number) -> Fraction:
    if isinstance(number, Fraction):
        return number
    if isinstance(number, float):
        if number != number or number in (float("inf"), float("-inf")):
            raise ValueError("non-finite interval factor")
        return Fraction(number)
    return Fraction(int(number))


def parse_interval(text: str) -> Interval:
    """Parse an ISO 8601 duration such as ``P1Y2M3DT4H5M6S`` or ``PT36H``.

    Years fold into months, weeks into days, hours and minutes into seconds.
    Only the seconds component may carry a fraction, kept to the microsecond.
    A leading sign negates the whole duration; each component may also carry
    its own sign.  ``P`` on its own, a ``T`` with nothing after it, and any
    other text raise :class:`ValueError`.
    """

    if not isinstance(text, str):
        raise ValueError(f"interval text must be a string, got {type(text).__name__}")
    candidate = text.strip()
    match = _ISO_DURATION.match(candidate)
    if match is None:
        raise ValueError(f"not an ISO 8601 duration: {text!r}")
    groups = match.groupdict()
    date_parts = [groups[key] for key in ("years", "months", "weeks", "days")]
    time_parts = [groups[key] for key in ("hours", "minutes", "seconds")]
    if all(part is None for part in date_parts + time_parts):
        raise ValueError(f"interval has no components: {text!r}")
    if groups["time"] and all(part is None for part in time_parts):
        raise ValueError(f"interval time part is empty: {text!r}")

    months = int(groups["years"] or 0) * 12 + int(groups["months"] or 0)
    days = int(groups["weeks"] or 0) * 7 + int(groups["days"] or 0)
    micros = int(groups["hours"] or 0) * _MICROS_PER_HOUR
    micros += int(groups["minutes"] or 0) * _MICROS_PER_MINUTE
    if groups["seconds"] is not None:
        micros += round(Fraction(groups["seconds"]) * MICROS_PER_SECOND)
    result = Interval(months, days, micros)
    if groups["sign"] == "-":
        result = -result
    return result


def _format_seconds(micros: int) -> str:
    whole, rest = _split(micros, MICROS_PER_SECOND)
    if rest == 0:
        return str(whole)
    fraction = f"{abs(rest):06d}".rstrip("0")
    sign = "-" if micros < 0 else ""
    return f"{sign}{abs(whole)}.{fraction}"


def format_interval(interval: Interval) -> str:
    """Render as an ISO 8601 duration, leaving out components that are zero.

    Months are shown as years plus months, microseconds as hours, minutes and
    seconds; days stay days.  Nothing crosses a field, so ``PT36H`` stays
    ``PT36H``.  A zero interval is ``PT0S``.
    """

    years, months = _split(interval.months, 12)
    hours, rest = _split(interval.micros, _MICROS_PER_HOUR)
    minutes, rest = _split(rest, _MICROS_PER_MINUTE)
    parts = ["P"]
    if years:
        parts.append(f"{years}Y")
    if months:
        parts.append(f"{months}M")
    if interval.days:
        parts.append(f"{interval.days}D")
    time = []
    if hours:
        time.append(f"{hours}H")
    if minutes:
        time.append(f"{minutes}M")
    if rest:
        time.append(f"{_format_seconds(rest)}S")
    if time:
        parts.append("T")
        parts.extend(time)
    if len(parts) == 1:
        return "PT0S"
    return "".join(parts)


def add_to_temporal(stamp: dt.date, interval: Interval) -> dt.datetime:
    """Add ``interval`` to a date or timestamp; the result is always a timestamp.

    Months are applied first, clamping the day to the last day of the target
    month, then days, then the time part.
    """

    if isinstance(stamp, dt.datetime):
        base = stamp
    else:
        base = dt.datetime(stamp.year, stamp.month, stamp.day)
    if interval.months:
        total = base.year * 12 + (base.month - 1) + interval.months
        year, month0 = divmod(total, 12)
        month = month0 + 1
        if not 1 <= year <= 9999:
            raise OverflowError("timestamp out of range")
        last = calendar.monthrange(year, month)[1]
        base = base.replace(year=year, month=month, day=min(base.day, last))
    return base + dt.timedelta(days=interval.days, microseconds=interval.micros)


def subtract_temporal(left: dt.date, right: dt.date) -> Any:
    """``left - right`` for dates and timestamps.

    Two plain dates give a whole number of days.  Anything involving a
    timestamp gives an interval of days and microseconds with no month part,
    the day count truncated toward zero.
    """

    if not isinstance(left, dt.datetime) and not isinstance(right, dt.datetime):
        return (left - right).days
    return Interval.from_timedelta(_as_datetime(left) - _as_datetime(right))


def _as_datetime(value: dt.date) -> dt.datetime:
    if isinstance(value, dt.datetime):
        return value
    return dt.datetime(value.year, value.month, value.day)


def interval_field(field: str, interval: Interval) -> int:
    """One stored component of an interval, for ``extract``.

    ``year`` and ``month`` split the month count, ``hour``, ``minute`` and
    ``second`` split the time part; ``day`` is the day count.  Nothing crosses
    a field, so ``PT36H`` has 36 hours and 0 days.  Every part keeps the sign
    of its field and ``second`` is truncated to a whole number.
    """

    unit = field.strip().lower()
    years, months = _split(interval.months, 12)
    hours, rest = _split(interval.micros, _MICROS_PER_HOUR)
    minutes, rest = _split(rest, _MICROS_PER_MINUTE)
    seconds, _ = _split(rest, MICROS_PER_SECOND)
    if unit == "year":
        return years
    if unit == "month":
        return months
    if unit == "day":
        return interval.days
    if unit == "hour":
        return hours
    if unit == "minute":
        return minutes
    if unit == "second":
        return seconds
    raise ValueError(f"cannot extract {field!r} from an interval")
