import pytest

from signalbox.topology.scheme import scheme_from_text
from signalbox.verify.checks import aspect as _aspect  # noqa: F401
from signalbox.verify.report import Severity
from signalbox.verify.rules import Context, run


@pytest.fixture
def context(kingsmoor):
    return Context.build(kingsmoor)


def test_a_three_aspect_behind_a_four_aspect_signal_loses_a_warning(context):
    report = run(context, only=["aspect-clamp"])
    assert not report.clean
    assert report.ok
    assert all(finding.severity is Severity.WARNING for finding in report)


def test_the_finding_says_which_aspect_was_lost(context):
    findings = run(context, only=["aspect-clamp"]).findings
    assert any("wants" in finding.detail and "shows" in finding.detail for finding in findings)


def test_every_kingsmoor_signal_has_a_route(context):
    assert run(context, only=["aspect-dark"]).clean


def test_a_signal_facing_the_wrong_way_can_never_clear():
    scheme = scheme_from_text("""
    node A boundary
    node B boundary
    edge E1 from A to B length 800 direction down
    section TA over E1
    signal S1 on E1 at 400 facing backward direction down
    """)
    report = run(Context.build(scheme), only=["aspect-dark"])
    assert [f.subject for f in report] == ["S1"]
    assert "can never clear" in report.findings[0].message


def test_shunt_signals_are_not_expected_to_clear():
    scheme = scheme_from_text("""
    node A boundary
    node B boundary
    edge E1 from A to B length 800 direction down
    section TA over E1
    signal S1 on E1 at 400 facing backward aspects 2 type shunt
    """)
    assert run(Context.build(scheme), only=["aspect-dark"]).clean


def test_the_branch_route_wants_approach_control(context):
    report = run(context, only=["aspect-junction"])
    assert "K3(MB)" in {finding.subject for finding in report}
    assert report.ok


def test_the_finding_gives_the_speed_drop(context):
    report = run(context, only=["aspect-junction"])
    finding = next(f for f in report if f.subject == "K3(MB)")
    assert finding.detail == "50 mph drop"
    assert "40 mph" in finding.message


def test_a_route_that_does_not_diverge_is_left_alone(context):
    report = run(context, only=["aspect-junction"])
    assert report.about("K3(MA)") == []


def test_a_gentle_divergence_is_left_alone():
    scheme = scheme_from_text("""
    node A boundary
    node P1 points
    node B boundary
    node C boundary
    edge E1 from A to P1.toe length 800 speed 60 direction down
    edge E2 from P1.normal to B length 400 speed 60 direction down
    edge E3 from P1.reverse to C length 400 speed 50 direction down
    section TA over E1
    section TB over E2
    section TC over E3
    signal S1 on E1 at 700 facing forward direction down
    """)
    assert run(Context.build(scheme), only=["aspect-junction"]).clean
