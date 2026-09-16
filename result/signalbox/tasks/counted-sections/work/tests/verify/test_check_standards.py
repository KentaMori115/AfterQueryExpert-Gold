import pytest

from signalbox.topology.scheme import scheme_from_text
from signalbox.verify.checks import standards as _standards  # noqa: F401
from signalbox.verify.report import Severity
from signalbox.verify.rules import Context, run

PLAN = """
{standards}
node A boundary
node B boundary
edge E1 from A to B length 900 speed 60 direction down
section TA over E1
"""


def context_for(settings=""):
    block = f"standards {{\n{settings}\n}}\n" if settings else ""
    return Context.build(scheme_from_text(PLAN.format(standards=block)))


@pytest.fixture
def kingsmoor_context(kingsmoor):
    return Context.build(kingsmoor)


def test_the_default_figures_pass(kingsmoor_context):
    report = run(
        kingsmoor_context,
        only=["standards-braking", "standards-overlap", "standards-reduced"],
    )
    assert report.clean


def test_a_braking_rate_nothing_could_manage_is_warned():
    report = run(context_for("  braking 3"), only=["standards-braking"])
    assert [f.subject for f in report] == ["standards"]
    assert "3.00 m/s2" in report.findings[0].message
    assert report.worst() is Severity.WARNING


def test_a_braking_rate_that_is_far_too_gentle_is_warned():
    assert run(context_for("  braking 0.05"), only=["standards-braking"])


def test_an_overlap_that_would_not_hold_a_train_is_warned():
    report = run(context_for("  overlap 10\n  reduced_overlap 5"), only=["standards-overlap"])
    assert "an overlap of 10m" in report.findings[0].message


def test_a_generous_overlap_passes():
    assert run(context_for("  overlap 400"), only=["standards-overlap"]).clean


def test_a_flank_search_shorter_than_the_layout_is_noted():
    report = run(context_for("  flank 100"), only=["standards-flank"])
    assert "the flank search is 100m" in report.findings[0].message
    assert report.ok


def test_a_flank_search_that_covers_the_layout_passes():
    assert run(context_for("  flank 5000"), only=["standards-flank"]).clean


def test_a_reduced_overlap_longer_than_the_standard_is_an_error():
    report = run(
        context_for("  overlap 100\n  reduced_overlap 200"), only=["standards-reduced"]
    )
    assert not report.ok
    assert "the wrong way round" in report.findings[0].detail


def test_the_two_overlaps_the_right_way_round_pass():
    context = context_for("  overlap 200\n  reduced_overlap 50")
    assert run(context, only=["standards-reduced"]).clean
