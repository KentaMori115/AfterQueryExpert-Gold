"""The README has to describe the thing that is actually here.

Nobody reads a README against the code, so the tests do it: every command it
shows exists, every file it links to is there, and every plan it prints parses.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from typer.testing import CliRunner

from signalbox.cli.main import app
from signalbox.layout.parser import parse

ROOT = Path(__file__).parent.parent
README = ROOT / "README.md"
runner = CliRunner()

LINK = re.compile(r"\[[^\]]+\]\(([^)]+)\)")
FENCE = re.compile(r"```sbx\n(.*?)```", re.DOTALL)


@pytest.fixture(scope="module")
def text() -> str:
    return README.read_text(encoding="utf-8")


def commands(text: str) -> list[list[str]]:
    found = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped.startswith("signalbox "):
            continue
        without_comment = stripped.split("#")[0].strip()
        found.append(without_comment.split()[1:])
    return found


def test_the_readme_shows_some_commands(text):
    assert len(commands(text)) >= 10


def test_every_command_it_shows_exists(text):
    listed = runner.invoke(app, ["--help"]).stdout
    for parts in commands(text):
        assert parts[0] in listed, parts[0]


def test_every_option_it_shows_is_real(text):
    for parts in commands(text):
        help_text = runner.invoke(app, [parts[0], "--help"]).stdout
        for word in parts[1:]:
            if word.startswith("--"):
                assert word.split("=")[0] in help_text, f"{parts[0]} {word}"


def test_every_file_it_links_to_is_there(text):
    for target in LINK.findall(text):
        if target.startswith("http"):
            continue
        assert (ROOT / target).exists(), target


def test_every_plan_it_prints_parses(text):
    blocks = FENCE.findall(text)
    assert blocks
    for number, block in enumerate(blocks, start=1):
        parse(block, source=f"README block {number}")


def test_it_mentions_the_documents_that_exist(text):
    for name in ("docs/language.md", "docs/rules.md", "CHANGELOG.md"):
        assert name in text, name


def test_it_says_how_to_run_the_tests(text):
    assert "make check" in text or "pytest" in text


def test_it_describes_every_layer_of_the_package(text):
    for layer in ("layout", "topology", "signalling", "tables", "verify", "sim", "cli"):
        assert f"`{layer}`" in text, layer
