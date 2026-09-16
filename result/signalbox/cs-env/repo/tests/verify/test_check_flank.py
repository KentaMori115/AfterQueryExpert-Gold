import pytest

from signalbox.topology.scheme import scheme_from_text
from signalbox.verify.checks import flank as _flank  # noqa: F401  (registers the rules)
from signalbox.verify.report import Severity
from signalbox.verify.rules import Context, run

PROTECTED = """
node WD boundary
node P1 points
node P2 points
node ED boundary
node S buffer
node T buffer
edge E1 from WD to P1.toe length 600 direction down
edge E2 from P1.normal to P2.toe length 500 direction down
edge E3 from P1.reverse to S length 200 direction down
edge E4 from P2.normal to ED length 400 direction down
edge E5 from P2.reverse to T length 200 direction down
section TA over E1
section TB over E2
section TC over E3
section TD over E4
section TE over E5
signal S1 on E1 at 560 facing forward direction down
signal S2 on E2 at 460 facing forward direction down
"""


@pytest.fixture
def context(kingsmoor):
    return Context.build(kingsmoor)


def test_the_open_end_towards_the_branch_is_found(context):
    report = run(context, only=["flank-open"])
    subjects = {finding.subject for finding in report}
    assert "K3(MA)" in subjects
    assert report.worst() is Severity.ERROR


def test_the_finding_says_where_it_looked(context):
    finding = run(context, only=["flank-open"]).by_rule("flank-open")[0]
    assert "nothing protects the flank at" in finding.message
    assert finding.detail.startswith("searched")


def test_a_flank_that_ends_at_a_buffer_stop_is_not_reported():
    context = Context.build(scheme_from_text(PROTECTED))
    report = run(context, only=["flank-open"])
    # S1(MB) runs to S2 past the siding at P1, and S2(MA) runs out to the
    # boundary past the siding at P2. Both are flanked by buffer stops.
    assert report.about("S1(MB)") == []
    assert report.about("S2(MA)") == []


def test_a_flank_that_ends_at_the_scheme_boundary_is_reported():
    context = Context.build(scheme_from_text(PROTECTED))
    report = run(context, only=["flank-open"])
    assert {finding.subject for finding in report} == {"S1(MA)", "S2(MB)"}


def test_protection_by_a_held_signal_is_only_a_warning(context):
    report = run(context, only=["flank-signal"])
    assert report.ok
    assert all(finding.severity is Severity.WARNING for finding in report)
    assert any("held only by K8" in finding.message for finding in report)


def test_flank_points_called_two_ways_are_an_error():
    context = Context.build(scheme_from_text(PROTECTED))
    assert run(context, only=["flank-shared"]).clean


def test_kingsmoor_flank_points_agree_with_each_other(context):
    assert run(context, only=["flank-shared"]).clean


def test_running_all_three_flank_rules_together(context):
    report = run(context, only=["flank-open", "flank-signal", "flank-shared"])
    assert report.ran == ("flank-open", "flank-signal", "flank-shared")
    assert not report.ok
