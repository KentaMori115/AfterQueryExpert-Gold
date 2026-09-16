import pytest

from signalbox.topology.scheme import scheme_from_text
from signalbox.verify.checks import gradient as _gradient  # noqa: F401
from signalbox.verify.report import Severity
from signalbox.verify.rules import Context, run

LINE = """
node A boundary
node J1 plain
node J2 plain
node B boundary
edge E1 from A to J1 length 900 speed 60 direction down
edge E2 from J1 to J2 length 900 speed 60 gradient {first} direction down
edge E3 from J2 to B length 900 speed 60 gradient {second} direction down
section TA over E1
section TB over E2
section TC over E3
signal S1 on E1 at 900 facing forward direction down
signal S3 on E3 at 900 facing forward direction down
"""


def context_for(first="level", second="level"):
    return Context.build(scheme_from_text(LINE.format(first=first, second=second)))


@pytest.fixture
def kingsmoor_context(kingsmoor):
    return Context.build(kingsmoor)


def test_a_level_route_falls_into_nothing():
    assert run(context_for(), only=["gradient-falling"]).clean


def test_a_route_falling_into_its_signal_is_noted():
    report = run(context_for(second="1 in -100"), only=["gradient-falling"])
    assert [f.subject for f in report] == ["S1(M)"]
    assert "falls" in report.findings[0].message
    assert report.ok


def test_a_route_rising_into_its_signal_is_not_noted():
    assert run(context_for(second="1 in 100"), only=["gradient-falling"]).clean


def test_a_barely_falling_route_is_not_worth_naming():
    assert run(context_for(second="1 in -5000"), only=["gradient-falling"]).clean


def test_gentle_gradients_are_not_steep():
    assert run(context_for(first="1 in 400"), only=["gradient-steep"]).clean


def test_a_steep_gradient_is_a_warning():
    report = run(context_for(first="1 in 50"), only=["gradient-steep"])
    assert report
    assert "1 in 50" in report.findings[0].message
    assert report.worst() is Severity.WARNING


def test_a_route_that_only_rises_has_no_summit():
    assert run(context_for(first="1 in 200", second="1 in 200"), only=["gradient-summit"]).clean


def test_a_route_that_rises_then_falls_has_one():
    report = run(context_for(first="1 in 200", second="1 in -200"), only=["gradient-summit"])
    assert report
    assert "rises then falls" in report.findings[0].message


def test_kingsmoor_gradients_are_not_steep(kingsmoor_context):
    assert run(kingsmoor_context, only=["gradient-steep"]).clean


def test_kingsmoor_has_a_route_falling_into_its_signal(kingsmoor_context):
    report = run(kingsmoor_context, only=["gradient-falling"])
    assert report.ok
