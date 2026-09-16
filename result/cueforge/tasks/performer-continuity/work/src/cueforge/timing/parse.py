"""Parse authored time, duration, offset, and speed tokens without floats."""

from __future__ import annotations

import re

from cueforge.codes import (
    CF2001_INVALID_TIME,
    CF2002_SCIENTIFIC_NOTATION,
    CF2003_NEGATIVE_DURATION,
    CF2004_OVERFLOW,
    CF2006_BAD_SPEED,
    CF2007_FRACTIONAL_MS,
)
from cueforge.findings import Finding, Severity
from cueforge.timing.instants import INT64_MAX, INT64_MIN

_SCI = re.compile(r"[eE]")
_INT = re.compile(r"^[+-]?[0-9]+$")
_DEC = re.compile(r"^[+-]?[0-9]+(\.[0-9]+)?$")

# maximum_speed may have at most 3 fractional decimal places (units per second).
MAX_SPEED_FRACTION_DIGITS = 3


def _finding(code: str, message: str, subject_id: str | None = None) -> Finding:
    return Finding(
        code=code,
        severity=Severity.ERROR,
        message=message,
        subject_kind="time",
        subject_id=subject_id,
    )


def token_text(value: object) -> str:
    if isinstance(value, bool):
        raise TypeError("boolean is not a numeric token")
    if isinstance(value, int):
        return str(value)
    if isinstance(value, str):
        return value.strip()
    raise TypeError(f"unsupported numeric token type {type(value).__name__}")


def reject_scientific(text: str, subject_id: str | None = None) -> Finding | None:
    if _SCI.search(text):
        return _finding(
            CF2002_SCIENTIFIC_NOTATION,
            f"scientific notation is not allowed: {text!r}",
            subject_id,
        )
    return None


def parse_int64(value: object, *, field: str = "value") -> tuple[int | None, Finding | None]:
    try:
        text = token_text(value)
    except TypeError as exc:
        return None, _finding(CF2001_INVALID_TIME, f"{field} {exc}")
    sci = reject_scientific(text, field)
    if sci is not None:
        return None, sci
    if not _INT.match(text):
        if _DEC.match(text) and "." in text:
            return None, _finding(
                CF2007_FRACTIONAL_MS,
                f"{field} must be an integer millisecond value: {text!r}",
                field,
            )
        return None, _finding(CF2001_INVALID_TIME, f"{field} is not an integer: {text!r}", field)
    try:
        parsed = int(text, 10)
    except ValueError:
        return None, _finding(CF2001_INVALID_TIME, f"{field} is not an integer: {text!r}", field)
    if parsed < INT64_MIN or parsed > INT64_MAX:
        return None, _finding(CF2004_OVERFLOW, f"{field} exceeds signed 64-bit range", field)
    return parsed, None


def parse_offset_ms(value: object, *, field: str = "offset") -> tuple[int | None, Finding | None]:
    return parse_int64(value, field=field)


def parse_duration_ms(value: object, *, field: str = "duration") -> tuple[int | None, Finding | None]:
    parsed, finding = parse_int64(value, field=field)
    if finding is not None:
        return None, finding
    assert parsed is not None
    if parsed < 0:
        return None, _finding(
            CF2003_NEGATIVE_DURATION,
            f"{field} must be non-negative, got {parsed}",
            field,
        )
    return parsed, None


def parse_speed_milli(value: object, *, field: str = "maximum_speed") -> tuple[int | None, Finding | None]:
    """Parse units/second into milli-units per second (1.4 -> 1400)."""
    try:
        text = token_text(value)
    except TypeError as exc:
        return None, _finding(CF2006_BAD_SPEED, f"{field} {exc}", field)
    sci = reject_scientific(text, field)
    if sci is not None:
        return None, sci
    if not _DEC.match(text):
        return None, _finding(CF2006_BAD_SPEED, f"{field} is not a decimal: {text!r}", field)
    negative = text.startswith("-")
    unsigned = text[1:] if text[0] in "+-" else text
    if "." in unsigned:
        whole, frac = unsigned.split(".", 1)
        if len(frac) > MAX_SPEED_FRACTION_DIGITS:
            return None, _finding(
                CF2006_BAD_SPEED,
                f"{field} may have at most {MAX_SPEED_FRACTION_DIGITS} fractional digits",
                field,
            )
        frac = frac.ljust(MAX_SPEED_FRACTION_DIGITS, "0")
    else:
        whole, frac = unsigned, "0" * MAX_SPEED_FRACTION_DIGITS
    if whole == "":
        whole = "0"
    try:
        milli = int(whole, 10) * 10**MAX_SPEED_FRACTION_DIGITS + int(frac, 10)
    except ValueError:
        return None, _finding(CF2006_BAD_SPEED, f"{field} is not a decimal: {text!r}", field)
    if negative:
        milli = -milli
    if milli <= 0:
        return None, _finding(CF2006_BAD_SPEED, f"{field} must be positive", field)
    if milli > INT64_MAX:
        return None, _finding(CF2004_OVERFLOW, f"{field} exceeds signed 64-bit range", field)
    return milli, None
