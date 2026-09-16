import pytest

from signalbox.layout.loader import load_path
from signalbox.topology.scheme import build_scheme, scheme_from_text
from signalbox.verify.checks import crossing as _crossing  # noqa: F401
from signalbox.verify.report import Severity
from signalbox.verify.rules import Context, run


@pytest.fixture
def marlow():
    return Context.build(build_scheme(load_path("tests/data/marlow-crossing.sbx")))


def test_an_automatic_crossing_with_room_passes(marlow):
    assert run(marlow, only=["crossing-warning"]).clean


def test_an_automatic_crossing_too_near_the_start_of_its_edge_is_warned():
    scheme = scheme_from_text("""
    node A boundary
    node B boundary
    edge E1 from A to B length 2000 speed 90 direction down
    section TA over E1
    crossing LC9 on E1 at 100 type ahb strike_in 30
    """)
    report = run(Context.build(scheme), only=["crossing-warning"])
    assert [f.subject for f in report] == ["LC9"]
    assert "of approach wanted at 90 mph" in report.findings[0].message
    assert report.findings[0].detail == "30s warning time"
    assert report.worst() is Severity.WARNING


def test_a_manual_barrier_is_not_judged_on_warning_time():
    scheme = scheme_from_text("""
    node A boundary
    node B boundary
    edge E1 from A to B length 2000 speed 90 direction down
    section TA over E1
    crossing LC9 on E1 at 10 type mcb
    """)
    assert run(Context.build(scheme), only=["crossing-warning"]).clean


def test_track_with_no_speed_is_left_alone():
    scheme = scheme_from_text("""
    node A boundary
    node B boundary
    edge E1 from A to B length 2000 direction down
    section TA over E1
    crossing LC9 on E1 at 10 type ahb
    """)
    assert run(Context.build(scheme), only=["crossing-warning"]).clean


def test_a_user_worked_crossing_on_slow_line_passes(marlow):
    assert run(marlow, only=["crossing-open"]).clean


def test_a_user_worked_crossing_on_fast_line_is_warned():
    scheme = scheme_from_text("""
    node A boundary
    node B boundary
    edge E1 from A to B length 2000 speed 90 direction down
    section TA over E1
    crossing LC9 on E1 at 900 type uwc
    """)
    report = run(Context.build(scheme), only=["crossing-open"])
    assert [f.subject for f in report] == ["LC9"]
    assert "a uwc crossing on 90 mph line" in report.findings[0].message


def test_routes_over_a_proved_crossing_are_noted(marlow):
    report = run(marlow, only=["crossing-route"])
    assert [f.subject for f in report] == ["M1(M)"]
    assert report.findings[0].message == "proves 1 crossing"
    assert "LC21 barriers down" in report.findings[0].detail
    assert report.ok


def test_a_scheme_with_no_crossings_has_nothing_to_say(kingsmoor):
    context = Context.build(kingsmoor)
    report = run(context, only=["crossing-warning", "crossing-open", "crossing-route"])
    assert report.clean
