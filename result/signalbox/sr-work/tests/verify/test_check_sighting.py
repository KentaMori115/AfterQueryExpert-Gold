import pytest

from signalbox.topology.scheme import scheme_from_text
from signalbox.verify.checks import sighting as _sighting  # noqa: F401
from signalbox.verify.report import Severity
from signalbox.verify.rules import Context, run

PLAN = """
node A boundary
node B boundary
edge E1 from A to B length 2000 speed 60 direction down
section TA over E1
signal S1 on E1 at 800 facing forward direction down sighting {good}
signal S3 on E1 at 1400 facing forward direction down sighting {bad}
"""


def context_for(good="400", bad="100"):
    return Context.build(scheme_from_text(PLAN.format(good=good, bad=bad)))


@pytest.fixture
def kingsmoor_context(kingsmoor):
    return Context.build(kingsmoor)


def test_a_short_sighting_is_an_error():
    report = run(context_for(), only=["sighting-short"])
    assert [f.subject for f in report] == ["S3"]
    assert "short of" in report.findings[0].detail
    assert report.worst() is Severity.ERROR


def test_an_adequate_sighting_passes():
    assert run(context_for(bad="400"), only=["sighting-short"]).clean


def test_kingsmoor_signals_are_not_measured(kingsmoor_context):
    report = run(kingsmoor_context, only=["sighting-short"])
    assert report.clean


def test_signals_nobody_measured_are_noted(kingsmoor_context):
    report = run(kingsmoor_context, only=["sighting-unmeasured"])
    assert "K1" in {f.subject for f in report}
    assert report.ok


def test_a_measured_signal_is_not_noted():
    report = run(context_for(), only=["sighting-unmeasured"])
    assert report.clean


def test_a_nonsense_sighting_distance_is_an_error():
    report = run(context_for(bad="soon"), only=["sighting-nonsense"])
    assert [f.subject for f in report] == ["S3"]
    assert "should be a number" in report.findings[0].detail


def test_a_nonsense_distance_does_not_break_the_other_rules():
    report = run(context_for(bad="soon"), only=["sighting-short", "sighting-unmeasured"])
    assert report.clean


def test_numbers_are_not_reported_as_nonsense():
    assert run(context_for(), only=["sighting-nonsense"]).clean


def test_track_with_no_speed_wants_no_sighting():
    scheme = scheme_from_text("""
    node A boundary
    node B boundary
    edge E1 from A to B length 900 direction down
    section TA over E1
    signal S1 on E1 at 400 facing forward direction down
    """)
    assert run(Context.build(scheme), only=["sighting-unmeasured"]).clean
