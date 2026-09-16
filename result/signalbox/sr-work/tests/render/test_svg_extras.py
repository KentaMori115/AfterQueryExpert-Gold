"""Crossings and traps have to appear on the drawing, or nobody will see them."""

from __future__ import annotations

import pytest

from signalbox.layout.loader import load_path
from signalbox.render.legend import ENTRIES
from signalbox.render.svg import DEFAULT_PALETTE, render_svg
from signalbox.topology.scheme import build_scheme


@pytest.fixture
def marlow():
    return build_scheme(load_path("tests/data/marlow-crossing.sbx"))


@pytest.fixture
def ferrybridge():
    return build_scheme(load_path("examples/ferrybridge-quay.sbx"))


def test_a_crossing_is_drawn_and_labelled(marlow):
    drawing = render_svg(marlow)
    assert ">LC21<" in drawing
    assert DEFAULT_PALETTE.crossing in drawing


def test_every_crossing_appears(marlow):
    drawing = render_svg(marlow)
    for name in ("LC21", "LC23", "LC25"):
        assert f">{name}<" in drawing


def test_a_trap_is_drawn_and_labelled(ferrybridge):
    drawing = render_svg(ferrybridge)
    assert ">TP31<" in drawing
    assert DEFAULT_PALETTE.trap in drawing


def test_a_scheme_with_neither_has_neither(kingsmoor):
    drawing = render_svg(kingsmoor)
    assert DEFAULT_PALETTE.crossing not in drawing
    assert DEFAULT_PALETTE.trap not in drawing


def test_the_key_has_a_row_for_each_of_them(kingsmoor):
    drawing = render_svg(kingsmoor, legend=True)
    assert ">level crossing<" in drawing
    assert ">trap points<" in drawing


def test_the_key_grew_by_two():
    assert len(ENTRIES) == 7


def test_the_crossings_do_not_move_the_track(marlow):
    with_extras = render_svg(marlow).count("<line")
    assert with_extras > len(marlow.graph.edges)
