from typer.testing import CliRunner

from signalbox.cli.main import app

runner = CliRunner()
PLAN = "tests/data/netherby-mileage.sbx"
KINGSMOOR = "tests/data/kingsmoor.sbx"


def test_chainage_lists_every_node():
    result = runner.invoke(app, ["chainage", PLAN])
    assert result.exit_code == 0
    for node in ("W", "J", "E"):
        assert node in result.stdout


def test_the_mileage_is_printed_in_miles_and_chains():
    result = runner.invoke(app, ["chainage", PLAN])
    assert "12m 0.00ch" in result.stdout
    assert "13m" in result.stdout


def test_the_range_is_summarised():
    result = runner.invoke(app, ["chainage", PLAN])
    assert "from W" in result.stdout


def test_a_datum_can_be_chosen():
    result = runner.invoke(app, ["chainage", PLAN, "--datum", "E"])
    assert result.exit_code == 0
    assert "from E" in result.stdout


def test_an_unknown_datum_is_a_clean_error():
    result = runner.invoke(app, ["chainage", PLAN, "--datum", "nowhere"])
    assert result.exit_code == 2


def test_signals_can_be_asked_for_instead():
    result = runner.invoke(app, ["chainage", PLAN, "--signals"])
    assert "N1" in result.stdout
    assert "signal" in result.stdout


def test_a_scheme_with_no_mileage_says_how_to_give_it_one():
    result = runner.invoke(app, ["chainage", KINGSMOOR])
    assert result.exit_code == 0
    assert "no mileage in this scheme" in result.stdout


def test_a_missing_plan_is_a_clean_error(tmp_path):
    assert runner.invoke(app, ["chainage", str(tmp_path / "no.sbx")]).exit_code == 2
