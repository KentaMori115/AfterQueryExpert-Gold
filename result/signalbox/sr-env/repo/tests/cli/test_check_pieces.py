"""The pieces the check command is made of, tested without the command.

The command itself is a dozen lines of plumbing now. What is worth testing on
its own is the running, the narrowing and the naming, because those are where a
wrong answer would be quiet rather than loud.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from signalbox.cli.commands.check import FORMATS, _named_after, _narrow, _run_over
from signalbox.verify.report import Finding, Report, Severity
from signalbox.verify.waivers import parse_waivers

KINGSMOOR = Path("tests/data/kingsmoor.sbx")
EXAMPLES = sorted(Path("examples").glob("*.sbx"))


def test_both_formats_are_listed():
    assert set(FORMATS) == {"text", "json"}


def test_running_over_one_plan_leaves_the_subjects_alone():
    report = _run_over([KINGSMOOR], None, None)
    assert any(finding.subject == "K3(MA)" for finding in report)


def test_running_over_several_plans_names_each_one():
    report = _run_over(EXAMPLES, ["flank-open", "detection-gap"], None)
    for finding in report:
        assert ":" in finding.subject


def test_running_over_several_plans_gathers_them_all():
    report = _run_over(EXAMPLES, ["detection-joint"], None)
    plans = {finding.subject.split(":")[0] for finding in report}
    assert plans <= {path.stem for path in EXAMPLES}


def test_only_narrows_the_rules_that_ran():
    report = _run_over([KINGSMOOR], ["detection-gap"], None)
    assert report.ran == ("detection-gap",)


def test_skip_leaves_a_rule_out():
    report = _run_over([KINGSMOOR], None, ["flank-open"])
    assert "flank-open" not in report.ran


def test_naming_a_report_after_a_plan_keeps_everything_else():
    report = Report([Finding("r", Severity.ERROR, "K1", "a message", "detail")])
    named = _named_after(report, Path("somewhere/kingsmoor.sbx"))
    assert named[0].subject == "kingsmoor:K1"
    assert named[0].message == "a message"
    assert named[0].detail == "detail"
    assert named[0].severity is Severity.ERROR


def test_narrowing_by_nothing_changes_nothing():
    report = _run_over([KINGSMOOR], ["flank-open"], None)
    assert len(_narrow(report, None, None)) == len(report)


def test_narrowing_by_waivers_takes_them_out():
    report = _run_over([KINGSMOOR], ["flank-open"], None)
    waivers = parse_waivers("\n".join(f"{f.rule} {f.subject}" for f in report))
    assert len(_narrow(report, waivers, None)) == 0


def test_narrowing_keeps_the_rules_that_ran():
    report = _run_over([KINGSMOOR], ["flank-open"], None)
    assert _narrow(report, parse_waivers(""), None).ran == report.ran


@pytest.mark.parametrize("path", EXAMPLES, ids=lambda p: p.stem)
def test_every_example_can_be_run_over(path):
    report = _run_over([path], None, None)
    assert report.ran
