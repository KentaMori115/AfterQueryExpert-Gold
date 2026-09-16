import pytest

from signalbox.topology.scheme import scheme_from_text
from signalbox.verify.checks import route as _route  # noqa: F401
from signalbox.verify.report import Severity
from signalbox.verify.rules import Context, run


@pytest.fixture
def context(kingsmoor):
    return Context.build(kingsmoor)


def test_every_kingsmoor_signal_has_a_route(context):
    assert run(context, only=["route-none"]).clean


def test_a_signal_with_nowhere_to_go_is_an_error():
    scheme = scheme_from_text("""
    node A boundary
    node B boundary
    edge E1 from A to B length 400 direction down
    section TA over E1
    signal S1 on E1 at 200 facing backward direction down
    """)
    report = run(Context.build(scheme), only=["route-none"])
    assert [f.subject for f in report] == ["S1"]
    assert report.worst() is Severity.ERROR


def test_kingsmoor_has_no_duplicate_routes(context):
    assert run(context, only=["route-duplicate"]).clean


def test_kingsmoor_routes_are_a_sensible_length(context):
    assert run(context, only=["route-long"]).clean


def test_one_very_long_route_is_noted():
    scheme = scheme_from_text("""
    node A boundary
    node J1 plain
    node J2 plain
    node J3 plain
    node B boundary
    edge E1 from A to J1 length 400 speed 60 direction down
    edge E2 from J1 to J2 length 400 speed 60 direction down
    edge E3 from J2 to J3 length 6000 speed 60 direction down
    edge E4 from J3 to B length 400 speed 60 direction down
    section TA over E1
    section TB over E2
    section TC over E3
    section TD over E4
    signal S1 on E1 at 400 facing forward direction down
    signal S3 on E2 at 400 facing forward direction down
    signal S5 on E3 at 6000 facing forward direction down
    signal S7 on E4 at 400 facing forward direction down
    """)
    report = run(Context.build(scheme), only=["route-long"])
    assert [f.subject for f in report] == ["S3(M)"]
    assert "against an average" in report.findings[0].message
    assert report.ok


def test_a_scheme_with_too_few_routes_says_nothing():
    scheme = scheme_from_text("""
    node A boundary
    node B boundary
    edge E1 from A to B length 4000 speed 60 direction down
    section TA over E1
    signal S1 on E1 at 200 facing forward direction down
    """)
    assert run(Context.build(scheme), only=["route-long"]).clean


def test_kingsmoor_shunt_moves_are_over_slow_track(context):
    report = run(context, only=["route-shunt"])
    assert report.ok


def test_a_shunt_move_over_fast_track_is_noted():
    scheme = scheme_from_text("""
    node A boundary
    node B buffer
    edge E1 from A to B length 900 speed 60 direction bidirectional
    section TA over E1
    signal S1 on E1 at 200 facing forward aspects 2 type shunt
    """)
    report = run(Context.build(scheme), only=["route-shunt"])
    assert [f.subject for f in report] == ["S1(S)"]
    assert "60 mph track" in report.findings[0].message


def test_track_with_no_speed_is_left_alone():
    scheme = scheme_from_text("""
    node A boundary
    node B buffer
    edge E1 from A to B length 900 direction bidirectional
    section TA over E1
    signal S1 on E1 at 200 facing forward aspects 2 type shunt
    """)
    assert run(Context.build(scheme), only=["route-shunt"]).clean
