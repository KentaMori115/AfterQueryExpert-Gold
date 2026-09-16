"""Every plan in the documentation has to parse.

Documentation that has drifted from the thing it documents is worse than none,
because somebody will copy it. Every fenced ``sbx`` block in the docs is pulled
out and run through the parser, and the ones that describe a whole scheme are
built as well.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from signalbox.layout.parser import parse
from signalbox.layout.validate import validate
from signalbox.topology.scheme import build_scheme

DOCS = sorted((Path(__file__).parent.parent / "docs").glob("*.md"))
FENCE = re.compile(r"```sbx\n(.*?)```", re.DOTALL)


def blocks() -> list[tuple[str, int, str]]:
    found = []
    for path in DOCS:
        text = path.read_text(encoding="utf-8")
        for number, match in enumerate(FENCE.finditer(text), start=1):
            found.append((path.name, number, match.group(1)))
    return found


BLOCKS = blocks()


def test_there_are_blocks_to_check():
    assert len(BLOCKS) >= 5


@pytest.mark.parametrize(
    ("name", "number", "text"),
    BLOCKS,
    ids=[f"{name}-{number}" for name, number, _ in BLOCKS],
)
def test_a_documented_block_parses(name, number, text):
    scheme = parse(text, source=f"{name} block {number}")
    assert scheme is not None


@pytest.mark.parametrize(
    ("name", "number", "text"),
    [item for item in BLOCKS if "edge" in item[2] and "include" not in item[2]],
    ids=[
        f"{name}-{number}"
        for name, number, text in BLOCKS
        if "edge" in text and "include" not in text
    ],
)
def test_a_documented_layout_validates(name, number, text):
    scheme = parse(text, source=f"{name} block {number}")
    validate(scheme)
    assert build_scheme(scheme).graph.edges


def test_the_language_reference_covers_every_declaration():
    text = (Path(__file__).parent.parent / "docs" / "language.md").read_text()
    for word in (
        "scheme",
        "standards",
        "node",
        "edge",
        "section",
        "signal",
        "crossing",
        "trap",
        "include",
    ):
        assert f"{word} " in text, word


def test_the_node_kinds_in_the_docs_are_the_ones_there_are():
    from signalbox.layout.ast import NodeKind

    text = (Path(__file__).parent.parent / "docs" / "language.md").read_text()
    for kind in NodeKind:
        assert f"`{kind.value}`" in text, kind.value


def test_the_design_figures_in_the_docs_are_the_ones_there_are():
    from signalbox.standards import FIGURES

    text = (Path(__file__).parent.parent / "docs" / "language.md").read_text()
    for figure in FIGURES:
        assert figure in text, figure
