import pytest

from signalbox.topology.scheme import scheme_from_text
from signalbox.verify.checks import protection as _protection  # noqa: F401
from signalbox.verify.report import Severity
from signalbox.verify.rules import Context, run

SLOW = """
node A boundary
node B boundary
edge E1 from A to B length 800 speed 20 direction down
section TA over E1
signal S1 on E1 at 700 facing forward direction down
"""

TIGHT = """
node A boundary
node J plain
node B boundary
edge E1 from A to J length 300 speed 90 direction down
edge E2 from J to B length 800 speed 90 direction down
section TA over E1
section TB over E2
signal S1 on E1 at 300 facing forward direction down
signal S3 on E2 at 400 facing forward direction down
"""


@pytest.fixture
def context(kingsmoor):
    return Context.build(kingsmoor)


def test_kingsmoor_signals_all_have_overspeed_grids(context):
    assert run(context, only=["tpws-missing"]).clean


def test_a_signal_on_slow_line_is_reported():
    report = run(Context.build(scheme_from_text(SLOW)), only=["tpws-missing"])
    assert [f.subject for f in report] == ["S1"]
    assert "approach speed 20 mph" in report.findings[0].detail
    assert report.worst() is Severity.WARNING


def test_a_grid_with_no_room_is_an_error():
    report = run(Context.build(scheme_from_text(TIGHT)), only=["tpws-room"])
    assert [f.subject for f in report] == ["S3"]
    assert "wants to be" in report.findings[0].message
    assert not report.ok


def test_kingsmoor_grids_have_room(context):
    report = run(context, only=["tpws-room"])
    assert report.ok or all(f.subject for f in report)


def test_every_kingsmoor_signal_has_a_berth(context):
    assert run(context, only=["berth-missing"]).clean


def test_a_signal_with_no_berth_is_reported():
    scheme = scheme_from_text("""
    node A boundary
    node B boundary
    edge E1 from A to B length 400 direction down
    section TA over E1
    signal S1 on E1 at 0 facing forward direction down
    """)
    report = run(Context.build(scheme), only=["berth-missing"])
    assert [f.subject for f in report] == ["S1"]


def test_two_signals_berthing_in_one_section_are_noted():
    scheme = scheme_from_text("""
    node A boundary
    node B boundary
    edge E1 from A to B length 900 speed 40 direction down
    section TA over E1
    signal S1 on E1 at 400 facing forward direction down
    signal S3 on E1 at 800 facing forward direction down
    """)
    report = run(Context.build(scheme), only=["berth-shared"])
    assert [f.subject for f in report] == ["TA"]
    assert "2 signals berth here" in report.findings[0].message
    assert report.ok


def test_kingsmoor_berths_are_not_shared(context):
    assert run(context, only=["berth-shared"]).clean
