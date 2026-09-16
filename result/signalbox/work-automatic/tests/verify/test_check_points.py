import pytest

from signalbox.topology.scheme import scheme_from_text
from signalbox.verify.checks import points as _points  # noqa: F401
from signalbox.verify.report import Severity
from signalbox.verify.rules import Context, run

JUNCTION = """
node A boundary
node P1 points {settings}
node B boundary
node C boundary
edge E1 from A to P1.toe length 800 speed 40 direction down
edge E2 from P1.normal to B length 400 speed 40 direction down
edge E3 from P1.reverse to C length 400 speed 40 direction down
section TA over E1
section TB over E2
section TC over E3
signal S1 on E1 at 800 facing forward direction down
"""


def context_for(settings=""):
    return Context.build(scheme_from_text(JUNCTION.format(settings=settings)))


@pytest.fixture
def kingsmoor_context(kingsmoor):
    return Context.build(kingsmoor)


def test_locked_facing_points_pass(kingsmoor_context):
    assert run(kingsmoor_context, only=["points-lock"]).clean


def test_unlocked_facing_points_are_an_error():
    report = run(context_for("lock no"), only=["points-lock"])
    assert [f.subject for f in report] == ["P1"]
    assert "no lock on the blades" in report.findings[0].message
    assert report.worst() is Severity.ERROR


def test_unlocked_trailing_points_are_not_an_error():
    scheme = scheme_from_text("""
    node A boundary
    node P1 points lock no
    node B boundary
    node C boundary
    edge E1 from P1.toe to A length 800 speed 40 direction up
    edge E2 from B to P1.normal length 400 speed 40 direction up
    edge E3 from C to P1.reverse length 400 speed 40 direction up
    section TA over E1
    section TB over E2
    section TC over E3
    """)
    assert run(Context.build(scheme), only=["points-lock"]).clean


def test_hand_points_under_a_signalled_route_are_warned():
    report = run(context_for("motor hand"), only=["points-hand"])
    assert [f.subject for f in report] == ["P1"]
    assert "hand worked" in report.findings[0].message


def test_electric_points_are_not_warned_about(kingsmoor_context):
    assert run(kingsmoor_context, only=["points-hand"]).clean


def test_points_nothing_uses_are_noted():
    scheme = scheme_from_text("""
    node A boundary
    node P1 points
    node B buffer
    node C boundary
    edge E1 from A to P1.toe length 100
    edge E2 from P1.normal to C length 100
    edge E3 from P1.reverse to B length 100
    """)
    report = run(Context.build(scheme), only=["points-unused"])
    assert [f.subject for f in report] == ["P1"]
    assert report.ok


def test_used_points_are_not_noted(kingsmoor_context):
    assert run(kingsmoor_context, only=["points-unused"]).clean


def test_slow_points_are_noted():
    report = run(context_for("throw 20"), only=["points-slow"])
    assert [f.subject for f in report] == ["P1"]
    assert "20.0s to throw" in report.findings[0].message


def test_quick_points_are_not_noted(kingsmoor_context):
    assert run(kingsmoor_context, only=["points-slow"]).clean
