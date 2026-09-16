import pytest

from signalbox.signalling.braking import BrakingModel
from signalbox.topology.scheme import scheme_from_text
from signalbox.verify.checks import spacing as _spacing  # noqa: F401
from signalbox.verify.report import Severity
from signalbox.verify.rules import Context, run

ROOMY = """
node A boundary
node B boundary
edge E1 from A to B length 6000 speed 60 direction down
section TA over E1
signal S1 on E1 at 500 facing forward direction down aspects 3
signal S2 on E1 at 5500 facing forward direction down aspects 3
"""

CRAMPED = ROOMY.replace("at 5500", "at 900")


@pytest.fixture
def context(kingsmoor):
    return Context.build(kingsmoor)


def test_signals_a_long_way_apart_pass():
    assert run(Context.build(scheme_from_text(ROOMY)), only=["spacing-short"]).clean


def test_signals_too_close_together_fail():
    report = run(Context.build(scheme_from_text(CRAMPED)), only=["spacing-short"])
    assert [f.subject for f in report] == ["S1(M)"]
    assert "400m between S1 and S2" in report.findings[0].message
    assert report.worst() is Severity.ERROR


def test_the_finding_names_the_aspects_and_the_gradient():
    report = run(Context.build(scheme_from_text(CRAMPED)), only=["spacing-short"])
    assert report.findings[0].detail == "3 aspect, level"


def test_a_gentler_braking_rate_makes_more_schemes_fail():
    scheme = scheme_from_text(ROOMY)
    strict = Context.build(scheme, braking=BrakingModel(rate=0.02))
    assert not run(strict, only=["spacing-short"]).clean


def test_track_with_no_speed_is_left_alone():
    scheme = scheme_from_text(ROOMY.replace(" speed 60", ""))
    assert run(Context.build(scheme), only=["spacing-short"]).clean


def test_kingsmoor_is_signalled_tightly_for_its_speed(context):
    report = run(context, only=["spacing-short"])
    assert not report.clean


def test_a_three_aspect_behind_a_four_aspect_is_a_warning():
    scheme = scheme_from_text(
        ROOMY.replace(
            "at 5500 facing forward direction down aspects 3",
            "at 5500 facing forward direction down aspects 4",
        )
    )
    report = run(Context.build(scheme), only=["spacing-heads"])
    assert [f.subject for f in report] == ["S1(M)"]
    assert "3 aspects behind 4 aspect S2" in report.findings[0].message


def test_a_four_aspect_behind_a_three_aspect_is_allowed():
    scheme = scheme_from_text(
        ROOMY.replace(
            "at 500 facing forward direction down aspects 3",
            "at 500 facing forward direction down aspects 4",
        )
    )
    assert run(Context.build(scheme), only=["spacing-heads"]).clean
