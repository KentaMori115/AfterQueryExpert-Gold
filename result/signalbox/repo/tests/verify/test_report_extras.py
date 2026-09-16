import pytest

from signalbox.verify.report import Finding, Report, Severity


@pytest.fixture
def report():
    return Report(
        [
            Finding("a", Severity.ERROR, "K1", "one"),
            Finding("b", Severity.WARNING, "K2", "two"),
            Finding("c", Severity.ADVICE, "K3", "three"),
        ],
        ran=("a", "b", "c"),
    )


def test_findings_can_be_asked_for_by_bar(report):
    assert len(report.at_least(Severity.ERROR)) == 1
    assert len(report.at_least(Severity.WARNING)) == 2
    assert len(report.at_least(Severity.ADVICE)) == 3


def test_a_report_passes_at_the_bar_it_is_held_to(report):
    assert not report.passes(Severity.ERROR)
    assert not report.passes(Severity.WARNING)


def test_a_report_with_only_advice_passes_at_warnings():
    only_advice = Report([Finding("c", Severity.ADVICE, "K3", "three")])
    assert only_advice.passes(Severity.WARNING)
    assert only_advice.passes(Severity.ERROR)


def test_a_clean_report_passes_at_any_bar():
    assert Report().passes(Severity.ADVICE)


def test_repeated_findings_are_taken_out():
    twice = Report(
        [
            Finding("a", Severity.ERROR, "K1", "one"),
            Finding("a", Severity.ERROR, "K1", "the same thing again"),
            Finding("b", Severity.WARNING, "K1", "something else"),
        ]
    )
    assert len(twice.deduplicated()) == 2


def test_deduplicating_keeps_the_worst_of_a_pair():
    mixed = Report(
        [
            Finding("a", Severity.ADVICE, "K1", "gentle"),
            Finding("a", Severity.ERROR, "K1", "serious"),
        ]
    )
    kept = list(mixed.deduplicated())
    assert kept[0].severity is Severity.ERROR


def test_deduplicating_keeps_the_rules_that_ran(report):
    assert report.deduplicated().ran == report.ran


def test_a_report_with_nothing_repeated_is_unchanged(report):
    assert len(report.deduplicated()) == len(report)
