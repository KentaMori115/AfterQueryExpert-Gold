"""Date and timestamp scalar functions.

``now()`` and ``current_date()`` are marked volatile so that constant folding
leaves them alone; every other function here is pure.
"""

from __future__ import annotations

import datetime as dt
from typing import Any, Sequence

from ..errors import ExecutionError
from ..types.datatypes import DATE, INTEGER, STRING, TIMESTAMP, DataType, TypeKind
from ..types.interval import Interval, interval_field
from .signature import Arity, ScalarFunctionDef, fixed_type

__all__ = ["register", "extract_field", "truncate_to"]

_FIELDS = (
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
)

_TRUNC_UNITS = ("year", "quarter", "month", "week", "day", "hour", "minute", "second")


def _as_datetime(value: Any) -> dt.datetime:
    if isinstance(value, dt.datetime):
        return value
    if isinstance(value, dt.date):
        return dt.datetime(value.year, value.month, value.day)
    raise ExecutionError(f"expected a date or timestamp, got {type(value).__name__}")


def extract_field(field: str, value: Any) -> int:
    """Return one component of a date, timestamp or interval.

    ``dayofweek`` is 1 for Monday through 7 for Sunday, matching ISO 8601.
    An interval hands back one of its stored fields: ``year`` and ``month``
    split its month count, ``hour``, ``minute`` and ``second`` split its time
    part, ``day`` is its day count, and nothing crosses a field.
    """

    unit = field.strip().lower()
    if isinstance(value, Interval):
        try:
            return interval_field(unit, value)
        except ValueError as exc:
            raise ExecutionError(str(exc), hint="interval fields: year, month, day, hour, minute, second") from exc
    stamp = _as_datetime(value)
    if unit == "year":
        return stamp.year
    if unit == "quarter":
        return (stamp.month - 1) // 3 + 1
    if unit == "month":
        return stamp.month
    if unit == "week":
        return stamp.isocalendar()[1]
    if unit == "day":
        return stamp.day
    if unit == "dayofweek":
        return stamp.isoweekday()
    if unit == "dayofyear":
        return stamp.timetuple().tm_yday
    if unit == "hour":
        return stamp.hour
    if unit == "minute":
        return stamp.minute
    if unit == "second":
        return stamp.second
    raise ExecutionError(
        f"unsupported extract field {field!r}",
        hint="supported fields: " + ", ".join(_FIELDS),
    )


def truncate_to(unit: str, value: Any) -> dt.datetime:
    """Round a timestamp down to the start of ``unit``."""

    key = unit.strip().lower()
    stamp = _as_datetime(value)
    if key == "year":
        return dt.datetime(stamp.year, 1, 1)
    if key == "quarter":
        month = ((stamp.month - 1) // 3) * 3 + 1
        return dt.datetime(stamp.year, month, 1)
    if key == "month":
        return dt.datetime(stamp.year, stamp.month, 1)
    if key == "week":
        start = stamp - dt.timedelta(days=stamp.isoweekday() - 1)
        return dt.datetime(start.year, start.month, start.day)
    if key == "day":
        return dt.datetime(stamp.year, stamp.month, stamp.day)
    if key == "hour":
        return stamp.replace(minute=0, second=0, microsecond=0)
    if key == "minute":
        return stamp.replace(second=0, microsecond=0)
    if key == "second":
        return stamp.replace(microsecond=0)
    raise ExecutionError(
        f"unsupported truncation unit {unit!r}",
        hint="supported units: " + ", ".join(_TRUNC_UNITS),
    )


def _extract(args: Sequence[Any]) -> int:
    return extract_field(str(args[0]), args[1])


def _date_trunc(args: Sequence[Any]) -> dt.datetime:
    return truncate_to(str(args[0]), args[1])


def _date_add(args: Sequence[Any]) -> Any:
    stamp = args[0]
    days = int(args[1])
    if isinstance(stamp, dt.datetime):
        return stamp + dt.timedelta(days=days)
    if isinstance(stamp, dt.date):
        return stamp + dt.timedelta(days=days)
    raise ExecutionError("date_add() expects a date or timestamp")


def _date_diff(args: Sequence[Any]) -> int:
    left = _as_datetime(args[0])
    right = _as_datetime(args[1])
    return (left.date() - right.date()).days


def _year(args: Sequence[Any]) -> int:
    return extract_field("year", args[0])


def _month(args: Sequence[Any]) -> int:
    return extract_field("month", args[0])


def _day(args: Sequence[Any]) -> int:
    return extract_field("day", args[0])


def _to_date(args: Sequence[Any]) -> dt.date:
    from ..types.values import parse_date

    parsed = parse_date(str(args[0]))
    if parsed is None:
        raise ExecutionError(f"cannot parse {args[0]!r} as a date")
    return parsed


def _format_date(args: Sequence[Any]) -> str:
    stamp = _as_datetime(args[0])
    return stamp.strftime(str(args[1]))


def _now(_: Sequence[Any]) -> dt.datetime:
    return dt.datetime.now()


def _current_date(_: Sequence[Any]) -> dt.date:
    return dt.date.today()


def _date_result(args: Sequence[DataType]) -> DataType:
    nullable = any(arg.nullable or arg.is_null for arg in args)
    if args and args[0].kind is TypeKind.DATE:
        return DATE.as_nullable(nullable)
    return TIMESTAMP.as_nullable(nullable)


def register(registry: Any) -> None:
    """Add every temporal function to ``registry``."""

    integer_type = fixed_type(INTEGER)
    timestamp_type = fixed_type(TIMESTAMP)
    date_type = fixed_type(DATE)
    string_type = fixed_type(STRING)

    def scalar(
        name: str,
        arity: Arity,
        resolver: Any,
        impl: Any,
        description: str,
        *,
        volatile: bool = False,
    ) -> None:
        registry.register_scalar(
            ScalarFunctionDef(
                name=name,
                arity=arity,
                resolve_type=resolver,
                evaluate=impl,
                description=description,
                volatile=volatile,
            )
        )

    scalar("extract", Arity.exactly(2), integer_type, _extract, "Extract a date part")
    scalar("date_trunc", Arity.exactly(2), timestamp_type, _date_trunc, "Truncate a timestamp")
    scalar("date_add", Arity.exactly(2), _date_result, _date_add, "Add whole days")
    scalar("date_diff", Arity.exactly(2), integer_type, _date_diff, "Whole days between dates")
    scalar("year", Arity.exactly(1), integer_type, _year, "Calendar year")
    scalar("month", Arity.exactly(1), integer_type, _month, "Calendar month")
    scalar("day", Arity.exactly(1), integer_type, _day, "Day of month")
    scalar("to_date", Arity.exactly(1), date_type, _to_date, "Parse an ISO date")
    scalar("format_date", Arity.exactly(2), string_type, _format_date, "strftime formatting")
    scalar("now", Arity.exactly(0), timestamp_type, _now, "Current timestamp", volatile=True)
    scalar(
        "current_date",
        Arity.exactly(0),
        date_type,
        _current_date,
        "Current date",
        volatile=True,
    )
