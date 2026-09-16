import pytest

from signalbox.verify.report import Finding, Report, Severity
from signalbox.verify.rules import Context, Rule, find, registered, rule, run


def test_severity_orders_worst_first():
    assert Severity.ERROR.value > Severity.WARNING.value > Severity.ADVICE.value
    assert Severity.ERROR.blocks_approval
    assert not Severity.WARNING.blocks_approval
    assert str(Severity.ADVICE) == "advice"


def test_findings_print_with_their_rule_and_subject():
    finding = Finding("flank", Severity.ERROR, "K1(M)", "unprotected flank", "P101.reverse")
    assert str(finding) == "error flank K1(M): unprotected flank (P101.reverse)"
    assert finding.key == ("flank", "K1(M)")


def test_findings_without_detail_print_plainly():
    assert str(Finding("x", Severity.ADVICE, "K1", "hello")) == "advice x K1: hello"


def test_an_empty_report_is_clean_and_ok():
    report = Report(ran=("a", "b"))
    assert report.clean and report.ok
    assert not report
    assert report.worst() is None
    assert report.summary() == "2 rules ran, nothing found"


def test_a_report_with_a_warning_is_not_clean_but_is_ok():
    report = Report([Finding("r", Severity.WARNING, "K1", "hmm")], ran=("r",))
    assert not report.clean
    assert report.ok
    assert report.worst() is Severity.WARNING
    assert report.summary() == "1 rules ran, 1 warning"


def test_a_report_with_an_error_is_not_ok():
    report = Report([Finding("r", Severity.ERROR, "K1", "no")], ran=("r",))
    assert not report.ok
    assert report.errors()


def test_findings_can_be_picked_out_several_ways():
    report = Report(
        [
            Finding("a", Severity.ERROR, "K1", "one"),
            Finding("b", Severity.ADVICE, "K1", "two"),
            Finding("b", Severity.WARNING, "K2", "three"),
        ]
    )
    assert len(report.by_rule("b")) == 2
    assert len(report.about("K1")) == 2
    assert len(report.advice()) == 1
    assert len(report.warnings()) == 1
    assert report.keys() == {("a", "K1"), ("b", "K1"), ("b", "K2")}


def test_sorting_puts_errors_first():
    report = Report(
        [
            Finding("z", Severity.ADVICE, "K2", "later"),
            Finding("a", Severity.ERROR, "K1", "first"),
        ]
    )
    assert [f.rule for f in report.sorted()] == ["a", "z"]
    assert report.text().splitlines()[-1].startswith("0 rules ran")


def test_the_context_builds_its_working_lazily(kingsmoor):
    context = Context.build(kingsmoor)
    assert len(context.plans()) == 12
    assert context.matrix is context.matrix
    assert context.locking.entry("K1(M)")
    assert context.chart.rule("K1(M)")


def test_rules_come_back_in_code_order():
    codes = [r.code for r in registered()]
    assert codes == sorted(codes)


def test_an_unknown_rule_is_reported():
    with pytest.raises(KeyError, match="no rule called nonsense"):
        find("nonsense")


def test_a_rule_cannot_be_registered_twice():
    @rule("test-duplicate", "only once")
    def _first(context):
        return []

    with pytest.raises(KeyError, match="registered twice"):

        @rule("test-duplicate", "again")
        def _second(context):
            return []


def test_running_a_named_rule_only(kingsmoor):
    context = Context.build(kingsmoor)
    report = run(context, only=["test-duplicate"])
    assert report.ran == ("test-duplicate",)
    assert report.clean


def test_rules_can_be_skipped(kingsmoor):
    context = Context.build(kingsmoor)
    report = run(context, skip=[r.code for r in registered()])
    assert report.ran == ()


def test_rules_print_their_title():
    check = Rule("flank", "flanks are protected", Severity.ERROR, lambda context: [])
    assert str(check) == "flank: flanks are protected"
    assert check(None) == []
