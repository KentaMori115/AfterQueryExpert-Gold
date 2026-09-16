import pytest

from signalbox.topology.scheme import scheme_from_text
from signalbox.verify.checks import locking as _locking  # noqa: F401
from signalbox.verify.report import Severity
from signalbox.verify.rules import Context, run

SINGLE_LINE = """
node A boundary
node B boundary
edge E1 from A to B length 2000 direction bidirectional
section TA over E1
signal S1 on E1 at 200 facing forward direction down
signal S2 on E1 at 1800 facing backward direction up
"""


@pytest.fixture
def context(kingsmoor):
    return Context.build(kingsmoor)


def test_kingsmoor_has_no_head_on_locking(context):
    assert run(context, only=["locking-headon"]).clean


def test_opposing_moves_over_one_track_are_caught_by_the_matrix():
    context = Context.build(scheme_from_text(SINGLE_LINE))
    assert run(context, only=["locking-headon"]).clean
    assert context.matrix.clashes("S1(M)", "S2(M)")


def test_no_kingsmoor_route_asks_for_points_two_ways(context):
    assert run(context, only=["locking-split"]).clean


def test_a_route_wanting_its_own_points_for_flank_would_be_an_error(context, monkeypatch):
    plan = context.interlocking.plan("K1(M)")
    monkeypatch.setattr(type(plan), "flank_points", lambda self: {"P103": _reverse()})
    report = run(context, only=["locking-split"])
    assert any(finding.subject == "K1(M)" for finding in report)
    assert report.worst() is Severity.ERROR


def _reverse():
    from signalbox.topology.graph import Lie

    return Lie.REVERSE


def test_bottlenecks_need_a_scheme_worth_measuring():
    context = Context.build(scheme_from_text(SINGLE_LINE))
    assert run(context, only=["locking-bottleneck"]).clean


def test_a_route_locking_out_most_of_the_scheme_is_reported(context):
    report = run(context, only=["locking-bottleneck"])
    assert report.ok
    for finding in report:
        assert "per cent of the scheme" in finding.detail


def test_kingsmoor_is_not_one_big_bottleneck(context):
    report = run(context, only=["locking-bottleneck"])
    assert len(report) < len(context.interlocking)
