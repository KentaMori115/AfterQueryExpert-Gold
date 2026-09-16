import pytest
from typer.testing import CliRunner

from signalbox.cli.main import app

runner = CliRunner()
PLAN = "tests/data/kingsmoor.sbx"


@pytest.fixture
def variant(tmp_path, kingsmoor_text):
    def write(text):
        path = tmp_path / "variant.sbx"
        path.write_text(text)
        return str(path)

    return write


def test_a_plan_against_itself_is_no_change():
    result = runner.invoke(app, ["diff", PLAN, PLAN])
    assert result.exit_code == 0
    assert "no change" in result.stdout


def test_a_removed_signal_shows_as_removed_routes(variant, kingsmoor_text):
    without = variant(
        kingsmoor_text.replace(
            "signal K7 on D7 at 250 facing forward direction down aspects 2\n", ""
        )
    )
    result = runner.invoke(app, ["diff", PLAN, without])
    assert result.exit_code == 1
    assert "removed K7(M)" in result.stdout


def test_an_added_signal_shows_as_an_added_route(variant, kingsmoor_text):
    extra = variant(
        kingsmoor_text + "signal K9 on D5 at 200 facing forward direction down aspects 3\n"
    )
    result = runner.invoke(app, ["diff", PLAN, extra])
    assert "added K9(M)" in result.stdout


def test_a_changed_column_is_named(variant, kingsmoor_text):
    dimmer = variant(kingsmoor_text.replace("aspects 4", "aspects 3"))
    result = runner.invoke(app, ["diff", PLAN, dimmer])
    assert "changed K1(M)" in result.stdout
    assert "aspect:" in result.stdout


def test_summary_prints_the_counts_only(variant, kingsmoor_text):
    dimmer = variant(kingsmoor_text.replace("aspects 4", "aspects 3"))
    result = runner.invoke(app, ["diff", PLAN, dimmer, "--summary"])
    assert "changed" in result.stdout
    assert "K1(M)" not in result.stdout


def test_the_comparison_can_be_narrowed(variant, kingsmoor_text):
    dimmer = variant(kingsmoor_text.replace("aspects 4", "aspects 3"))
    result = runner.invoke(app, ["diff", PLAN, dimmer, "--columns", "route,from,to"])
    assert result.exit_code == 0
    assert "no change" in result.stdout


def test_an_unknown_column_is_a_clean_error():
    result = runner.invoke(app, ["diff", PLAN, PLAN, "--columns", "weather"])
    assert result.exit_code == 2


def test_a_missing_plan_is_a_clean_error(tmp_path):
    result = runner.invoke(app, ["diff", PLAN, str(tmp_path / "no.sbx")])
    assert result.exit_code == 2
