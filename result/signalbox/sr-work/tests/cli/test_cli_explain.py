from typer.testing import CliRunner

from signalbox.cli.main import app
from signalbox.verify import checks as _checks  # noqa: F401
from signalbox.verify.rules import registered

runner = CliRunner()
PLAN = "tests/data/kingsmoor.sbx"


def test_rules_still_lists_everything():
    result = runner.invoke(app, ["rules"])
    assert result.exit_code == 0
    assert "flank-open" in result.stdout


def test_a_rule_can_be_explained():
    result = runner.invoke(app, ["rules", "--explain", "flank-open"])
    assert result.exit_code == 0
    assert "why:" in result.stdout
    assert "fix:" in result.stdout


def test_the_explanation_is_the_long_form():
    result = runner.invoke(app, ["rules", "--explain", "points-lock"])
    assert "facing point lock" in result.stdout.lower()


def test_an_unknown_rule_is_a_clean_error():
    result = runner.invoke(app, ["rules", "--explain", "wibble"])
    assert result.exit_code == 2


def test_check_can_print_what_to_do_about_each_finding():
    plain = runner.invoke(app, ["check", PLAN]).stdout
    explained = runner.invoke(app, ["check", PLAN, "--explain"]).stdout
    assert len(explained) > len(plain)


def test_the_advice_is_printed_once_per_rule():
    result = runner.invoke(app, ["check", PLAN, "--explain"])
    lines = result.stdout.splitlines()
    advice = [line for line in lines if line.startswith("       ")]
    assert len(advice) == len(set(advice))


def test_quiet_leaves_the_advice_out():
    result = runner.invoke(app, ["check", PLAN, "--explain", "--quiet"])
    assert "rules ran" in result.stdout
    assert not any(line.startswith("       ") for line in result.stdout.splitlines())


def test_every_rule_can_be_explained_from_the_command_line():
    for rule in registered():
        result = runner.invoke(app, ["rules", "--explain", rule.code])
        assert result.exit_code == 0, rule.code


def test_rules_can_be_filtered_by_severity():
    result = runner.invoke(app, ["rules", "--severity", "error"])
    assert result.exit_code == 0
    assert "of" in result.stdout
    assert "flank-open" in result.stdout
    assert "overlap-swing" not in result.stdout


def test_an_unknown_severity_is_a_clean_error():
    result = runner.invoke(app, ["rules", "--severity", "urgent"])
    assert result.exit_code == 2


def test_the_long_form_can_be_printed_for_everything():
    result = runner.invoke(app, ["rules", "--all"])
    assert result.exit_code == 0
    assert result.stdout.count("why:") == len(registered())


def test_the_count_of_rules_is_printed():
    result = runner.invoke(app, ["rules"])
    assert f"{len(registered())} of {len(registered())} rules" in result.stdout
