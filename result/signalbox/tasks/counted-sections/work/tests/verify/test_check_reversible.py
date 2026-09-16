import pytest

from signalbox.topology.scheme import scheme_from_text
from signalbox.verify.checks import reversible as _reversible  # noqa: F401
from signalbox.verify.report import Severity
from signalbox.verify.rules import Context, run

SINGLE_LINE = """
node A boundary
node J1 plain
node J2 plain
node B boundary
edge E1 from A to J1 length 800 speed 40 direction bidirectional
edge E2 from J1 to J2 length 800 speed 40 direction bidirectional
edge E3 from J2 to B length 800 speed 40 direction bidirectional
section TA over E1
section TB over E2
section TC over E3
signal S1 on E1 at 800 facing forward direction down
signal S2 on E3 at 0 facing backward direction up
"""


@pytest.fixture
def context(kingsmoor):
    return Context.build(kingsmoor)


@pytest.fixture
def single():
    return Context.build(scheme_from_text(SINGLE_LINE))


def subjects(report):
    return {finding.subject for finding in report}


def test_track_signalled_both_ways_is_not_reported(single):
    report = run(single, only=["reversible-unused"])
    assert "E2" not in subjects(report)


def test_track_signalled_one_way_only_is_reported(single):
    report = run(single, only=["reversible-unused"])
    assert "E1" in subjects(report)
    assert report.ok


def test_the_finding_says_which_way_it_is_used(single):
    report = run(single, only=["reversible-unused"])
    assert any("one way only" in finding.message for finding in report)


def test_track_nothing_runs_over_says_neither_way():
    scheme = scheme_from_text("""
    node A boundary
    node B boundary
    edge E1 from A to B length 800 direction bidirectional
    section TA over E1
    """)
    report = run(Context.build(scheme), only=["reversible-unused"])
    assert any("neither way" in finding.message for finding in report)


def test_one_way_track_is_never_reported(context):
    report = run(context, only=["reversible-unused"])
    assert "D1" not in subjects(report)


def test_the_kingsmoor_crossover_is_only_signalled_one_way(context):
    report = run(context, only=["reversible-unused"])
    assert "CX" in subjects(report)


def test_a_signal_reading_the_right_way_passes(context):
    assert run(context, only=["reversible-direction"]).clean


def test_a_signal_reading_against_the_traffic_is_an_error():
    scheme = scheme_from_text("""
    node A boundary
    node B boundary
    edge E1 from A to B length 800 speed 40 direction down
    section TA over E1
    signal S1 on E1 at 400 facing backward
    """)
    report = run(Context.build(scheme), only=["reversible-direction"])
    assert [finding.subject for finding in report] == ["S1"]
    assert "is down only" in report.findings[0].detail
    assert report.worst() is Severity.ERROR


def test_every_example_signals_its_one_way_track_correctly():
    from pathlib import Path

    from signalbox.layout.loader import load_path
    from signalbox.topology.scheme import build_scheme

    for plan in sorted(Path("examples").glob("*.sbx")):
        context = Context.build(build_scheme(load_path(plan)))
        assert run(context, only=["reversible-direction"]).clean, plan.name
