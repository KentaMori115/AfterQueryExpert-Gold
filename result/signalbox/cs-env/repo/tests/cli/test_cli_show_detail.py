"""The detail the show command prints about the layout itself.

Everything here is available from another command, but show is where somebody
looks first, so it has to be right and it has to be complete.
"""

from __future__ import annotations

import pytest
from typer.testing import CliRunner

from signalbox.cli.main import app

runner = CliRunner()
PLAN = "tests/data/kingsmoor.sbx"
MARLOW = "tests/data/marlow-crossing.sbx"


@pytest.fixture
def detail():
    return runner.invoke(app, ["show", PLAN, "--detail"]).stdout


def test_every_edge_is_listed(detail):
    for name in ("D1", "D2", "U1", "CX", "BE"):
        assert name in detail, name


def test_the_ends_of_each_edge_are_shown(detail):
    assert "P103.toe" in detail or "P103" in detail


def test_lengths_are_shown_in_metres(detail):
    assert "560m" in detail


def test_speeds_are_shown_where_there_are_any(detail):
    assert "90 mph" in detail


def test_gradients_are_shown(detail):
    assert "1 in 330" in detail
    assert "level" in detail


def test_the_section_covering_each_edge_is_shown(detail):
    assert "TA" in detail
    assert "TL" in detail


def test_the_summary_comes_before_the_detail(detail):
    lines = detail.splitlines()
    assert "Kingsmoor Junction" in lines[0]


def test_a_scheme_with_crossings_lists_them_without_detail():
    result = runner.invoke(app, ["show", MARLOW])
    assert "LC21" in result.stdout
    assert "strike in only" in result.stdout


def test_the_crossing_kinds_are_named():
    result = runner.invoke(app, ["show", MARLOW])
    for kind in ("mcb", "ahb", "uwc"):
        assert kind in result.stdout, kind


def test_the_totals_add_up():
    result = runner.invoke(app, ["show", PLAN])
    assert "20 edges" in result.stdout
    assert "km of track" in result.stdout
