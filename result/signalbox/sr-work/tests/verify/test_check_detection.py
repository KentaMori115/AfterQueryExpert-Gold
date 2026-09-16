import pytest

from signalbox.topology.scheme import scheme_from_text
from signalbox.verify.checks import detection as _detection  # noqa: F401
from signalbox.verify.report import Severity
from signalbox.verify.rules import Context, run


@pytest.fixture
def context(kingsmoor):
    return Context.build(kingsmoor)


def test_kingsmoor_detects_all_of_its_track(context):
    assert run(context, only=["detection-gap"]).clean


def test_an_undetected_edge_is_an_error():
    scheme = scheme_from_text("""
    node A boundary
    node N plain
    node B boundary
    edge E1 from A to N length 400 direction down
    edge E2 from N to B length 250 direction down
    section TA over E1
    """)
    report = run(Context.build(scheme), only=["detection-gap"])
    assert [f.subject for f in report] == ["E2"]
    assert report.findings[0].detail == "250m undetected"
    assert report.worst() is Severity.ERROR


def test_short_sections_pass(context):
    assert run(context, only=["detection-long"]).clean


def test_a_very_long_section_is_a_warning():
    scheme = scheme_from_text("""
    node A boundary
    node B boundary
    edge E1 from A to B length 2400 direction down
    section TA over E1
    """)
    report = run(Context.build(scheme), only=["detection-long"])
    assert [f.subject for f in report] == ["TA"]
    assert "2400m long" in report.findings[0].message


def test_kingsmoor_signals_all_stand_near_joints(context):
    assert run(context, only=["detection-joint"]).clean


def test_a_signal_in_the_middle_of_a_long_edge_is_noted():
    scheme = scheme_from_text("""
    node A boundary
    node B boundary
    edge E1 from A to B length 1000 direction down
    section TA over E1
    signal S1 on E1 at 500 facing forward direction down
    """)
    report = run(Context.build(scheme), only=["detection-joint"])
    assert [f.subject for f in report] == ["S1"]
    assert "500m from the nearest section joint" in report.findings[0].message
    assert report.ok


def test_all_three_detection_rules_run_together(context):
    report = run(context, only=["detection-gap", "detection-long", "detection-joint"])
    assert len(report.ran) == 3
    assert report.clean
