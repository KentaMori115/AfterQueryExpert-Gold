import pytest

from signalbox.verify.report import Finding, Report, Severity
from signalbox.verify.waivers import (
    Waiver,
    WaiverError,
    Waivers,
    parse_waivers,
    read_waivers,
    write_waivers,
)

TEXT = """
# accepted at the design review
flank-open K3(MA)      the branch is one engine in steam
overlap-short K3(MB)   the platform is too short

# and this one is only advice
overlap-swing K1(M)
"""


@pytest.fixture
def waivers():
    return parse_waivers(TEXT)


@pytest.fixture
def report():
    return Report(
        [
            Finding("flank-open", Severity.ERROR, "K3(MA)", "nothing protects it"),
            Finding("overlap-short", Severity.WARNING, "K3(MB)", "50m short"),
            Finding("spacing-short", Severity.ERROR, "K1(M)", "too close"),
        ],
        ran=("flank-open", "overlap-short", "spacing-short"),
    )


def test_lines_are_read_into_waivers(waivers):
    assert len(waivers) == 3
    assert waivers.waivers[0].rule == "flank-open"
    assert waivers.waivers[0].subject == "K3(MA)"


def test_the_reason_is_kept(waivers):
    assert waivers.waivers[0].reason == "the branch is one engine in steam"


def test_a_waiver_without_a_reason_is_allowed(waivers):
    assert waivers.waivers[2].reason == ""


def test_comments_and_blank_lines_are_ignored():
    assert len(parse_waivers("# nothing\n\n")) == 0


def test_a_line_with_only_a_rule_is_refused():
    with pytest.raises(WaiverError, match="expected a rule and a subject"):
        parse_waivers("flank-open\n", source="waivers.txt")


def test_accepted_findings_are_taken_out(waivers, report):
    left = waivers.apply(report)
    assert [finding.rule for finding in left] == ["spacing-short"]
    assert left.ran == report.ran


def test_the_accepted_ones_can_be_listed(waivers, report):
    assert len(waivers.accepted(report)) == 2


def test_a_waiver_for_a_finding_that_is_gone_is_unused(waivers, report):
    unused = waivers.unused(report)
    assert [waiver.subject for waiver in unused] == ["K1(M)"]


def test_the_summary_counts_both(waivers, report):
    assert waivers.summary(report) == ("2 of 3 findings accepted, 1 waivers no longer needed")


def test_an_empty_waiver_list_changes_nothing(report):
    assert len(Waivers().apply(report)) == len(report)


def test_a_waiver_file_can_be_written_from_a_report(report):
    text = write_waivers(report)
    assert text.startswith("# written by signalbox")
    assert "flank-open K3(MA)" in text
    assert len(parse_waivers(text)) == len(report)


def test_a_reason_can_be_given_for_everything(report):
    text = write_waivers(report, reason="accepted 12 February")
    assert "accepted 12 February" in text


def test_reading_a_file(tmp_path):
    path = tmp_path / "waivers.txt"
    path.write_text(TEXT)
    assert len(read_waivers(path)) == 3


def test_reading_a_file_that_is_not_there(tmp_path):
    with pytest.raises(WaiverError, match="cannot read"):
        read_waivers(tmp_path / "nothing.txt")


def test_waivers_print_readably():
    assert str(Waiver("flank-open", "K3(MA)", "because")) == "flank-open K3(MA)  because"
    assert str(Waiver("flank-open", "K3(MA)")) == "flank-open K3(MA)"
