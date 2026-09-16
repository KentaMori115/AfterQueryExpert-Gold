"""The package has to be installable and the entry point has to work.

Getting this wrong is the sort of thing that only shows up when somebody else
installs it, which is much too late. The metadata is read from the file rather
than from an installed distribution so that the test works in a checkout.
"""

from __future__ import annotations

import tomllib
from pathlib import Path

import pytest

import signalbox

ROOT = Path(__file__).parent.parent


@pytest.fixture(scope="session")
def pyproject() -> dict:
    return tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))


def test_the_version_matches_the_package(pyproject):
    assert pyproject["project"]["version"] == signalbox.__version__


def test_the_entry_point_points_at_something_that_exists(pyproject):
    target = pyproject["project"]["scripts"]["signalbox"]
    module, attribute = target.split(":")
    imported = __import__(module, fromlist=[attribute])
    assert getattr(imported, attribute) is not None


def test_every_dependency_is_pinned(pyproject):
    for requirement in pyproject["project"]["dependencies"]:
        assert "==" in requirement, requirement


def test_every_development_dependency_is_pinned(pyproject):
    for requirement in pyproject["project"]["optional-dependencies"]["dev"]:
        assert "==" in requirement, requirement


def test_the_python_version_is_stated(pyproject):
    assert pyproject["project"]["requires-python"].startswith(">=3.")


def test_the_package_is_found_under_src(pyproject):
    assert pyproject["tool"]["setuptools"]["packages"]["find"]["where"] == ["src"]


def test_the_linter_and_the_type_checker_are_configured(pyproject):
    assert pyproject["tool"]["ruff"]["line-length"] > 0
    assert pyproject["tool"]["mypy"]["strict"] is True


def test_the_test_runner_looks_in_tests(pyproject):
    assert pyproject["tool"]["pytest"]["ini_options"]["testpaths"] == ["tests"]


def test_coverage_has_a_bar(pyproject):
    assert pyproject["tool"]["coverage"]["report"]["fail_under"] >= 80


def test_coverage_measures_the_package(pyproject):
    assert pyproject["tool"]["coverage"]["run"]["source"] == ["signalbox"]
    assert pyproject["tool"]["coverage"]["run"]["branch"] is True


def test_the_workflow_checks_the_generated_documents():
    workflow = (ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
    assert "rules --markdown" in workflow
    assert "diff -u docs/rules.md" in workflow


def test_the_workflow_runs_the_same_checks_as_the_makefile():
    workflow = (ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
    for step in ("ruff check", "ruff format --check", "mypy", "pytest"):
        assert step in workflow, step


def test_the_makefile_has_the_jobs_the_readme_mentions():
    makefile = (ROOT / "Makefile").read_text(encoding="utf-8")
    for target in ("install:", "test:", "lint:", "typecheck:", "check:"):
        assert target in makefile, target


def test_the_package_exports_a_version():
    assert signalbox.__version__
    assert "__version__" in signalbox.__all__


def test_the_package_exports_the_short_way_in():
    for name in ("load", "parse", "check", "control_table", "interlocking"):
        assert name in signalbox.__all__, name


def test_the_changelog_mentions_the_current_version():
    changelog = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
    assert f"## {signalbox.__version__}" in changelog


def test_the_changelog_is_newest_first():
    changelog = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
    versions = [line[3:].strip() for line in changelog.splitlines() if line.startswith("## ")]
    assert versions == sorted(versions, reverse=True)
    assert versions[0] == signalbox.__version__


def test_every_released_version_says_something():
    changelog = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
    blocks = changelog.split("## ")[1:]
    for block in blocks:
        lines = [line for line in block.splitlines()[1:] if line.strip()]
        assert lines, block.splitlines()[0]


def test_the_changelog_mentions_the_commands_it_claims():
    changelog = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
    assert "signalbox pack" in changelog


def test_the_number_of_rules_in_the_changelog_is_right():
    from signalbox.verify import checks as _checks  # noqa: F401
    from signalbox.verify.rules import registered

    changelog = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
    words = {
        40: "forty",
        41: "forty one",
        42: "forty two",
        43: "forty three",
        44: "forty four",
        45: "forty five",
        46: "forty six",
        47: "forty seven",
        48: "forty eight",
        49: "forty nine",
        50: "fifty",
        51: "fifty one",
        52: "fifty two",
        53: "fifty three",
        54: "fifty four",
        55: "fifty five",
    }
    written = words.get(len(registered()))
    assert written is not None, f"no word for {len(registered())} rules"
    assert written.capitalize() in changelog or written in changelog


def test_the_linter_is_held_to_more_than_the_defaults(pyproject):
    selected = pyproject["tool"]["ruff"]["lint"]["select"]
    for family in ("C90", "N", "PERF", "PLR", "RET", "RUF", "SIM"):
        assert family in selected, family


def test_the_complexity_limit_is_set(pyproject):
    assert pyproject["tool"]["ruff"]["lint"]["mccabe"]["max-complexity"] <= 12


def test_every_ignored_rule_has_a_reason_written_next_to_it():
    text = (ROOT / "pyproject.toml").read_text(encoding="utf-8")
    block = text.split("ignore = [")[1].split("]")[0]
    entries = [line.strip() for line in block.splitlines() if line.strip()]
    for entry in entries:
        if entry.startswith("#"):
            continue
        index = entries.index(entry)
        assert index > 0 and entries[index - 1].startswith("#"), entry


def test_the_makefile_can_report_complexity():
    assert "complexity:" in (ROOT / "Makefile").read_text(encoding="utf-8")
