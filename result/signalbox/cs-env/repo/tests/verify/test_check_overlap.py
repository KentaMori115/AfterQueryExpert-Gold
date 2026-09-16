import pytest

from signalbox.topology.scheme import scheme_from_text
from signalbox.units import Distance
from signalbox.verify.checks import overlap as _overlap  # noqa: F401
from signalbox.verify.report import Severity
from signalbox.verify.rules import Context, run


@pytest.fixture
def context(kingsmoor):
    return Context.build(kingsmoor)


def test_the_short_overlaps_at_the_boundary_are_found(context):
    report = run(context, only=["overlap-short"])
    subjects = {finding.subject for finding in report}
    assert {"K3(MA)", "K3(MB)"} <= subjects
    assert report.ok


def test_the_finding_says_how_short(context):
    report = run(context, only=["overlap-short"])
    finding = next(f for f in report if f.subject == "K3(MB)")
    assert "50m" in finding.message
    assert "short of standard" in finding.message
    assert finding.detail == "TH"


def test_a_shorter_standard_makes_them_acceptable(kingsmoor):
    context = Context.build(kingsmoor, standard_overlap=Distance(40.0))
    assert run(context, only=["overlap-short"]).clean


def test_swinging_overlaps_are_reported_as_advice(context):
    report = run(context, only=["overlap-swing"])
    assert [f.subject for f in report] == ["K1(M)"]
    assert report.worst() is Severity.ADVICE
    assert "2 ways" in report.findings[0].message


def test_routes_that_want_no_overlap_are_not_chased(context):
    report = run(context, only=["overlap-missing"])
    assert report.about("K20(S)") == []
    assert report.about("K5(M)") == []


def test_a_signal_with_nothing_beyond_it_has_no_overlap():
    scheme = scheme_from_text("""
    node A boundary
    node B buffer
    edge E1 from A to B length 400 direction down
    section TA over E1
    signal S1 on E1 at 100 facing forward direction down
    signal S2 on E1 at 400 facing forward direction down
    """)
    report = run(Context.build(scheme), only=["overlap-missing"])
    assert [f.subject for f in report] == ["S1(M)"]
    assert "no overlap could be found" in report.findings[0].message
