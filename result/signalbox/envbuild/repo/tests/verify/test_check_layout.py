import pytest

from signalbox.topology.scheme import scheme_from_text
from signalbox.verify.checks import layout as _layout  # noqa: F401
from signalbox.verify.report import Severity
from signalbox.verify.rules import Context, run


@pytest.fixture
def context(kingsmoor):
    return Context.build(kingsmoor)


def test_kingsmoor_track_is_all_reachable(context):
    assert run(context, only=["layout-stranded"]).clean


def test_an_island_of_track_is_an_error():
    scheme = scheme_from_text("""
    node A boundary
    node B boundary
    node C buffer
    node D buffer
    edge E1 from A to B length 400 direction bidirectional
    edge E2 from C to D length 400 direction bidirectional
    section TA over E1
    section TB over E2
    """)
    report = run(Context.build(scheme), only=["layout-stranded"])
    assert [f.subject for f in report] == ["E2"]
    assert "nothing joins it" in report.findings[0].detail
    assert report.worst() is Severity.ERROR


def test_track_stranded_only_by_direction_says_so():
    scheme = scheme_from_text("""
    node A boundary
    node J plain
    node B buffer
    edge E1 from A to J length 400 direction down
    edge E2 from J to B length 400 direction up
    section TA over E1
    section TB over E2
    """)
    report = run(Context.build(scheme), only=["layout-stranded"])
    assert "only the direction of working" in report.findings[0].detail


def test_kingsmoor_sidings_can_be_left(context):
    assert run(context, only=["layout-deadend"]).clean


def test_a_one_way_siding_is_a_warning():
    scheme = scheme_from_text("""
    node A boundary
    node P1 points
    node B boundary
    node S buffer
    edge E1 from A to P1.toe length 400 direction down
    edge E2 from P1.normal to B length 400 direction down
    edge E3 from P1.reverse to S length 200 direction down
    section TA over E1
    section TB over E2
    section TC over E3
    """)
    report = run(Context.build(scheme), only=["layout-deadend"])
    assert [f.subject for f in report] == ["E3"]
    assert report.ok


def test_kingsmoor_signals_follow_the_prefix(context):
    assert run(context, only=["layout-naming"]).clean


def test_a_signal_that_ignores_the_prefix_is_noted(kingsmoor_text, tmp_path):
    from signalbox.layout.loader import load_text
    from signalbox.topology.scheme import build_scheme

    text = kingsmoor_text.replace("signal K7 on", "signal Q7 on")
    context = Context.build(build_scheme(load_text(text)))
    report = run(context, only=["layout-naming"])
    assert [f.subject for f in report] == ["Q7"]


def test_a_scheme_with_no_prefix_says_nothing():
    scheme = scheme_from_text("""
    node A boundary
    node B boundary
    edge E1 from A to B length 400 direction down
    section TA over E1
    signal Z9 on E1 at 200 facing forward direction down
    """)
    assert run(Context.build(scheme), only=["layout-naming"]).clean


def test_kingsmoor_numbering_follows_the_convention(context):
    assert run(context, only=["layout-numbering"]).clean


def test_an_even_down_signal_is_noted():
    scheme = scheme_from_text("""
    node A boundary
    node B boundary
    edge E1 from A to B length 400 direction down
    section TA over E1
    signal S2 on E1 at 200 facing forward direction down
    """)
    report = run(Context.build(scheme), only=["layout-numbering"])
    assert [f.subject for f in report] == ["S2"]
    assert "expected odd" in report.findings[0].message


def test_a_signal_with_no_number_is_left_alone():
    scheme = scheme_from_text("""
    node A boundary
    node B boundary
    edge E1 from A to B length 400 direction down
    section TA over E1
    signal SOUTH on E1 at 200 facing forward direction down
    """)
    assert run(Context.build(scheme), only=["layout-numbering"]).clean
