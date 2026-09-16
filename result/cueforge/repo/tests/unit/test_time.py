from cueforge.codes import CF2002_SCIENTIFIC_NOTATION, CF2003_NEGATIVE_DURATION, CF2006_BAD_SPEED, CF2007_FRACTIONAL_MS
from cueforge.timing.instants import Instant
from cueforge.timing.parse import parse_duration_ms, parse_int64, parse_offset_ms, parse_speed_milli


def test_parse_int_from_text_and_int() -> None:
    value, finding = parse_int64("42")
    assert finding is None
    assert value == 42
    value, finding = parse_int64(-8)
    assert finding is None
    assert value == -8


def test_reject_scientific_notation() -> None:
    _, finding = parse_int64("1e3")
    assert finding is not None
    assert finding.code == CF2002_SCIENTIFIC_NOTATION


def test_reject_fractional_milliseconds() -> None:
    _, finding = parse_int64("1.5", field="at")
    assert finding is not None
    assert finding.code == CF2007_FRACTIONAL_MS


def test_negative_duration_is_rejected() -> None:
    _, finding = parse_duration_ms("-1")
    assert finding is not None
    assert finding.code == CF2003_NEGATIVE_DURATION


def test_offset_may_be_negative() -> None:
    value, finding = parse_offset_ms("-800")
    assert finding is None
    assert value == -800


def test_speed_milli_from_decimal_text() -> None:
    value, finding = parse_speed_milli("1.4")
    assert finding is None
    assert value == 1400


def test_speed_rejects_four_fraction_digits() -> None:
    _, finding = parse_speed_milli("1.4001")
    assert finding is not None
    assert finding.code == CF2006_BAD_SPEED


def test_speed_must_be_positive() -> None:
    _, finding = parse_speed_milli("0")
    assert finding is not None
    assert finding.code == CF2006_BAD_SPEED


def test_instant_add_and_compare() -> None:
    instant = Instant(100).add(25)
    assert instant.ms == 125
    assert Instant(1) < Instant(2)
