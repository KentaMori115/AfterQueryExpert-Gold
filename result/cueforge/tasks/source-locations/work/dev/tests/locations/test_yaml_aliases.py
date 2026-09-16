"""Where findings point when YAML anchors and aliases are in play."""

from pathlib import Path

from cueforge import compile_production, load_production


def at(text: str, line: int, token: str, nth: int = 1) -> tuple[int, int]:
    """(line, column) of the nth occurrence of ``token`` on ``line`` of ``text``."""
    row = text.split("\n")[line - 1]
    index = -1
    for _ in range(nth):
        index = row.index(token, index + 1)
    return line, index + 1


def where(finding) -> tuple[int, int]:
    return finding.source.line, finding.source.column


def pick(findings, code: str, subject_id: str):
    picked = [item for item in findings if item.code == code and item.subject_id == subject_id]
    assert picked, [(item.code, item.subject_id, item.message) for item in findings]
    return picked[0]


def write(path: Path, text: str) -> Path:
    path.write_text(text, encoding="utf-8")
    return path


def load_findings(path: Path):
    return load_production(path).findings


def compile_findings(path: Path):
    loaded = load_production(path)
    assert loaded.value is not None, loaded.findings
    return compile_production(loaded.value).findings


ANCHORED = """version: 1
production: anchored
time_unit: ms
cues:
  - &lead
    id: lead
    trigger: {at: 0}
  - id: follow
    department: lx
    trigger: &go {after: &ref "ghost"}
  - id: late
    department: lx
    trigger: &t {at: 1.5}
"""

REUSED = """version: 1
production: reused
time_unit: ms
cues:
  - id: a
    department: lx
    trigger: {at: &x 1.5}
  - id: b
    department: lx
    trigger: &tr {at: *x}
  - id: c
    department: lx
    trigger: *tr
"""

WHOLE = """version: 1
production: whole
time_unit: ms
cues:
  - &a
    id: a
    department: lx
    trigger: &t {at: 0, bogus: 1}
  - &b {id: b, department: lx, trigger: *t}
  - *a
  - *b
"""


def test_anchor_before_block_mapping(tmp_path: Path) -> None:
    findings = load_findings(write(tmp_path / "anchored.yaml", ANCHORED))
    assert where(pick(findings, "CF1010", "cues.0.department")) == at(ANCHORED, 6, "id")


def test_anchor_before_flow_mapping(tmp_path: Path) -> None:
    findings = compile_findings(write(tmp_path / "anchored.yaml", ANCHORED.replace("  - &lead\n    id: lead\n", "  - id: lead\n    department: lx\n")))
    text = ANCHORED.replace("  - &lead\n    id: lead\n", "  - id: lead\n    department: lx\n")
    assert where(pick(findings, "CF2007", "late.at")) == at(text, 13, "1.5")


def test_anchor_before_quoted_scalar(tmp_path: Path) -> None:
    text = ANCHORED.replace("  - &lead\n    id: lead\n", "  - id: lead\n    department: lx\n")
    findings = compile_findings(write(tmp_path / "anchored.yaml", text))
    assert where(pick(findings, "CF1002", "follow")) == at(text, 10, '"')


def test_alias_of_a_scalar(tmp_path: Path) -> None:
    findings = compile_findings(write(tmp_path / "reused.yaml", REUSED))
    assert where(pick(findings, "CF2007", "a.at")) == at(REUSED, 7, "1.5")
    assert where(pick(findings, "CF2007", "b.at")) == at(REUSED, 10, "*x")


def test_alias_inside_an_alias(tmp_path: Path) -> None:
    findings = compile_findings(write(tmp_path / "reused.yaml", REUSED))
    assert where(pick(findings, "CF2007", "c.at")) == at(REUSED, 13, "*tr")


def test_one_finding_per_reuse(tmp_path: Path) -> None:
    findings = compile_findings(write(tmp_path / "reused.yaml", REUSED))
    spots = sorted(where(item) for item in findings if item.code == "CF2007")
    assert spots == [at(REUSED, 7, "1.5"), at(REUSED, 10, "*x"), at(REUSED, 13, "*tr")]


def test_alias_of_a_mapping_with_a_bad_key(tmp_path: Path) -> None:
    findings = load_findings(write(tmp_path / "whole.yaml", WHOLE))
    assert where(pick(findings, "CF1009", "cues.0.trigger.bogus")) == at(WHOLE, 8, "bogus")
    assert where(pick(findings, "CF1009", "cues.1.trigger.bogus")) == at(WHOLE, 9, "*t")
    assert where(pick(findings, "CF1009", "cues.2.trigger.bogus")) == at(WHOLE, 10, "*a")
    assert where(pick(findings, "CF1009", "cues.3.trigger.bogus")) == at(WHOLE, 11, "*b")


def test_alias_of_a_whole_cue(tmp_path: Path) -> None:
    text = WHOLE.replace(", bogus: 1", "")
    findings = compile_findings(write(tmp_path / "whole.yaml", text))
    assert where(pick(findings, "CF1001", "a")) == at(text, 10, "*a")
    assert where(pick(findings, "CF1001", "b")) == at(text, 11, "*b")
