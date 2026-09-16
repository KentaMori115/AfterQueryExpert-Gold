import pytest

from signalbox.topology.scheme import scheme_from_text
from signalbox.verify.checks import capacity as _capacity  # noqa: F401
from signalbox.verify.report import Severity
from signalbox.verify.rules import Context, run

LINE = """
node A boundary
node J1 plain
node J2 plain
node J3 plain
node B boundary
edge E1 from A to J1 length 1000 speed 90 direction down
edge E2 from J1 to J2 length 1000 speed 90 direction down
edge E3 from J2 to J3 length {long} speed 90 direction down
edge E4 from J3 to B length 1000 speed 90 direction down
section TA over E1
section TB over E2
section TC over E3
section TD over E4
signal S1 on E1 at 1000 facing forward direction down aspects {heads}
signal S3 on E2 at 1000 facing forward direction down aspects {heads}
signal S5 on E3 at {long} facing forward direction down aspects {heads}
signal S7 on E4 at 1000 facing forward direction down aspects {heads} {extra}
"""


def context_for(long=1000, heads=4, extra=""):
    return Context.build(scheme_from_text(LINE.format(long=long, heads=heads, extra=extra)))


@pytest.fixture
def kingsmoor_context(kingsmoor):
    return Context.build(kingsmoor)


def test_an_even_line_has_no_worst_block():
    assert run(context_for(), only=["capacity-worst"]).clean


def test_one_very_long_block_is_reported():
    report = run(context_for(long=6000), only=["capacity-worst"])
    assert len(report) == 1
    assert "headway against" in report.findings[0].message
    assert report.worst() is Severity.ADVICE


def test_a_scheme_with_too_few_blocks_says_nothing(kingsmoor_context):
    tiny = Context.build(
        scheme_from_text("""
    node A boundary
    node J plain
    node B boundary
    edge E1 from A to J length 900 speed 60 direction down
    edge E2 from J to B length 900 speed 60 direction down
    section TA over E1
    section TB over E2
    signal S1 on E1 at 900 facing forward direction down
    """)
    )
    assert run(tiny, only=["capacity-worst"]).clean


def test_no_target_means_nothing_to_say():
    assert run(context_for(), only=["capacity-target"]).clean


def test_a_target_that_is_missed_is_a_warning():
    context = context_for(extra="headway 30")
    report = run(context, only=["capacity-target"])
    assert len(report) == 1
    assert "against a target of 30s" in report.findings[0].message


def test_a_target_that_is_met_says_nothing():
    context = context_for(extra="headway 600")
    assert run(context, only=["capacity-target"]).clean


def test_a_nonsense_target_is_ignored():
    context = context_for(extra="headway soon")
    assert run(context, only=["capacity-target"]).clean


def test_three_aspect_signalling_on_fast_line_is_noted():
    report = run(context_for(heads=3), only=["capacity-heads"])
    assert report
    assert "3 aspect signalling on 90 mph line" in report.findings[0].message


def test_four_aspect_signalling_is_not_noted():
    assert run(context_for(heads=4), only=["capacity-heads"]).clean


def test_kingsmoor_has_a_three_aspect_on_fast_line(kingsmoor_context):
    report = run(kingsmoor_context, only=["capacity-heads"])
    assert report.ok
    assert {f.subject for f in report}
