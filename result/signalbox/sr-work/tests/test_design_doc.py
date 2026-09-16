"""The design document has to describe the package that is actually here."""

from __future__ import annotations

import pkgutil
from pathlib import Path

import pytest

import signalbox

ROOT = Path(__file__).parent.parent
DOC = ROOT / "docs" / "design.md"


@pytest.fixture(scope="module")
def text() -> str:
    return DOC.read_text(encoding="utf-8")


def packages() -> list[str]:
    return sorted(
        module.name for module in pkgutil.iter_modules(signalbox.__path__) if module.ispkg
    )


def test_the_document_is_there():
    assert DOC.exists()


def test_every_package_is_described(text):
    for name in packages():
        assert f"`{name}`" in text, name


def test_the_stack_diagram_lists_every_package(text):
    diagram = text.split("```")[1]
    for name in packages():
        assert name in diagram, name


def test_it_names_the_layers_in_the_right_order(text):
    diagram = text.split("```")[1]
    order = [line.split()[0] for line in diagram.splitlines() if line and line[0].isalpha()]
    assert order.index("cli") < order.index("signalling")
    assert order.index("signalling") < order.index("topology")
    assert order.index("topology") < order.index("layout")


def test_it_states_the_rules_of_the_road(text):
    assert "Nothing below `cli` prints" in text
    assert "Nothing below `layout.loader` reads a file" in text


def test_it_describes_the_test_layout(text):
    for name in ("tests/property/", "tests/test_golden.py", "tests/test_examples.py"):
        assert name in text, name
        assert (ROOT / name.rstrip("/")).exists(), name


def test_the_readme_points_at_it():
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    assert "docs/design.md" in readme
