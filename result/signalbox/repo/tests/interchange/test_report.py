import pytest

from signalbox.interchange.report import write_report
from signalbox.signalling.interlocking import build_interlocking
from signalbox.verify import checks as _checks  # noqa: F401
from signalbox.verify.report import Report
from signalbox.verify.rules import Context, run


@pytest.fixture
def text(kingsmoor):
    return write_report(kingsmoor, build_interlocking(kingsmoor))


def test_the_report_starts_with_the_area(text):
    assert text.splitlines()[0] == "Kingsmoor Junction"


def test_the_report_says_what_it_was_designed_to(text):
    assert "designed to overlap 183m" in text


def test_the_layout_section_counts_the_track(text):
    assert "20 edges" in text
    assert "km of track" in text
    assert "5 points" in text


def test_the_route_section_counts_the_routes(text):
    assert "12 routes" in text
    assert "swinging overlaps: K1(M)" in text


def test_the_protection_section_lists_the_open_flanks(text):
    assert "unprotected flanks" in text
    assert "K3(MA) at P101" in text


def test_the_capacity_section_gives_the_headway(text):
    assert "trains an hour" in text


def test_findings_are_left_out_when_none_are_given(text):
    assert "Findings" not in text


def test_findings_are_included_when_they_are_given(kingsmoor):
    context = Context.build(kingsmoor)
    text = write_report(kingsmoor, context.interlocking, run(context))
    assert "Findings" in text
    assert "rules ran" in text


def test_a_long_list_of_findings_is_cut_short(kingsmoor):
    findings = run(Context.build(kingsmoor))
    text = write_report(kingsmoor, build_interlocking(kingsmoor), findings)
    if len(findings) > 20:
        assert "and " in text and " more" in text


def test_an_empty_report_of_findings_still_prints(kingsmoor):
    text = write_report(kingsmoor, build_interlocking(kingsmoor), Report())
    assert "0 rules ran, nothing found" in text


def test_a_scheme_with_crossings_says_so():
    from signalbox.layout.loader import load_path
    from signalbox.topology.scheme import build_scheme

    scheme = build_scheme(load_path("tests/data/marlow-crossing.sbx"))
    text = write_report(scheme, build_interlocking(scheme))
    assert "3 level crossings" in text


def test_a_scheme_with_mileage_says_where_it_runs():
    from signalbox.layout.loader import load_path
    from signalbox.topology.scheme import build_scheme

    scheme = build_scheme(load_path("tests/data/netherby-mileage.sbx"))
    assert "mileage" in write_report(scheme, build_interlocking(scheme))


def test_the_report_ends_with_a_newline(text):
    assert text.endswith("\n")
