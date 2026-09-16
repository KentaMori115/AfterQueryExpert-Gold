import json

import pytest

from signalbox.interchange.findings import (
    FINDINGS_VERSION,
    as_dict,
    dumps,
    finding_as_dict,
)
from signalbox.verify.report import Finding, Report, Severity
from signalbox.verify.waivers import parse_waivers


@pytest.fixture
def report():
    return Report(
        [
            Finding("flank-open", Severity.ERROR, "K3(MA)", "nothing protects it", "P101"),
            Finding("overlap-short", Severity.WARNING, "K3(MB)", "50m short"),
        ],
        ran=("flank-open", "overlap-short"),
    )


def test_one_finding_carries_its_fields():
    found = finding_as_dict(
        Finding("flank-open", Severity.ERROR, "K3(MA)", "nothing protects it", "P101")
    )
    assert found == {
        "rule": "flank-open",
        "severity": "error",
        "subject": "K3(MA)",
        "message": "nothing protects it",
        "detail": "P101",
    }


def test_the_explanation_can_be_included():
    found = finding_as_dict(Finding("flank-open", Severity.ERROR, "K3(MA)", "no"), explain=True)
    assert "why" in found and "fix" in found


def test_a_rule_with_no_guidance_is_left_alone():
    found = finding_as_dict(Finding("wibble", Severity.ERROR, "K1", "no"), explain=True)
    assert "why" not in found


def test_the_report_carries_a_version(report):
    assert as_dict(report)["findings_version"] == FINDINGS_VERSION


def test_the_report_says_whether_it_is_ok(report):
    assert as_dict(report)["ok"] is False
    assert as_dict(Report())["ok"] is True


def test_the_rules_that_ran_are_listed(report):
    assert as_dict(report)["rules_run"] == ["flank-open", "overlap-short"]


def test_the_counts_are_by_severity(report):
    assert as_dict(report)["counts"] == {"error": 1, "warning": 1}


def test_the_findings_come_out_worst_first(report):
    findings = as_dict(report)["findings"]
    assert findings[0]["severity"] == "error"


def test_the_scheme_name_can_be_given(report):
    assert as_dict(report, scheme="kingsmoor")["scheme"] == "kingsmoor"


def test_accepted_findings_are_listed_separately(report):
    waivers = parse_waivers("flank-open K3(MA)  agreed\n")
    found = as_dict(report, waivers=waivers)
    assert [f["rule"] for f in found["accepted"]] == ["flank-open"]


def test_waivers_nobody_needs_are_listed(report):
    waivers = parse_waivers("flank-open K9(M)  nothing\n")
    found = as_dict(report, waivers=waivers)
    assert found["waivers_unused"] == [{"rule": "flank-open", "subject": "K9(M)"}]


def test_without_waivers_the_extra_keys_are_left_out(report):
    assert "accepted" not in as_dict(report)


def test_the_json_is_sorted_and_ends_with_a_newline(report):
    text = dumps(report)
    assert text.endswith("}\n")
    data = json.loads(text)
    assert list(data) == sorted(data)


def test_an_empty_report_still_writes(report):
    data = json.loads(dumps(Report(ran=("flank-open",))))
    assert data["findings"] == []
    assert data["counts"] == {}
