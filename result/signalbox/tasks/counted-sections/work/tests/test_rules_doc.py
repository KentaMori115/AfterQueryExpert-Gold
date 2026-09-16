"""The rules document is generated, so it cannot drift from the rules.

If this fails, run `signalbox rules --markdown > docs/rules.md` and commit the
result along with whatever changed the rules.
"""

from __future__ import annotations

from pathlib import Path

from typer.testing import CliRunner

from signalbox.cli.main import app
from signalbox.verify import checks as _checks  # noqa: F401
from signalbox.verify.guidance import as_markdown
from signalbox.verify.rules import registered

DOC = Path(__file__).parent.parent / "docs" / "rules.md"
runner = CliRunner()


def test_the_document_is_there():
    assert DOC.exists()


def test_the_document_matches_the_rules():
    assert DOC.read_text(encoding="utf-8") == as_markdown()


def test_the_command_prints_the_same_thing():
    result = runner.invoke(app, ["rules", "--markdown"])
    assert result.exit_code == 0
    assert result.stdout.rstrip() == as_markdown().rstrip()


def test_every_rule_has_a_heading():
    text = DOC.read_text(encoding="utf-8")
    for rule in registered():
        assert f"## {rule.code}" in text, rule.code


def test_every_rule_is_in_the_summary_table():
    text = DOC.read_text(encoding="utf-8")
    for rule in registered():
        assert f"| `{rule.code}` |" in text, rule.code


def test_the_table_has_a_row_for_every_rule():
    text = DOC.read_text(encoding="utf-8")
    rows = [line for line in text.splitlines() if line.startswith("| `")]
    assert len(rows) == len(registered())


def test_every_rule_says_what_to_do():
    text = DOC.read_text(encoding="utf-8")
    assert text.count("**What to do:**") == len(registered())


def test_the_document_says_how_it_was_made():
    assert "signalbox rules --markdown" in DOC.read_text(encoding="utf-8")
