"""Properties that have to hold for every plan the toolkit can read.

These are not examples of behaviour, they are statements about it: formatting is
idempotent, parsing what was formatted gives back the same declarations, and
everything derived from a plan is derived the same way twice. A failure here
usually means something has started depending on dictionary order.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from signalbox.interchange.model import as_dict
from signalbox.layout.format import format_scheme
from signalbox.layout.loader import load_path, load_text
from signalbox.signalling.interlocking import build_interlocking
from signalbox.tables.control_table import build_control_table
from signalbox.topology.scheme import build_scheme

ROOT = Path(__file__).parent.parent.parent
PLANS = sorted([*(ROOT / "examples").glob("*.sbx"), *(ROOT / "tests" / "data").glob("*.sbx")])


@pytest.fixture(params=PLANS, ids=lambda path: path.stem)
def plan(request):
    return request.param


def test_there_are_plans_to_check():
    assert len(PLANS) >= 3


def test_formatting_is_idempotent(plan):
    once = format_scheme(load_path(plan))
    twice = format_scheme(load_text(once, source=str(plan)))
    assert once == twice


def test_formatting_keeps_the_declarations(plan):
    before = load_path(plan)
    after = load_text(format_scheme(before), source=str(plan))
    assert [node.name for node in before.nodes] == [node.name for node in after.nodes]
    assert [edge.name for edge in before.edges] == [edge.name for edge in after.edges]
    assert [signal.name for signal in before.signals] == [
        signal.name for signal in after.signals
    ]


def test_formatting_keeps_the_lengths(plan):
    before = load_path(plan)
    after = load_text(format_scheme(before), source=str(plan))
    assert [edge.length_metres for edge in before.edges] == [
        edge.length_metres for edge in after.edges
    ]


def test_the_same_plan_gives_the_same_routes_twice(plan):
    scheme = build_scheme(load_path(plan))
    first = [route.name for route in build_interlocking(scheme).routes()]
    second = [route.name for route in build_interlocking(scheme).routes()]
    assert first == second


def test_the_same_plan_gives_the_same_table_twice(plan):
    scheme = build_scheme(load_path(plan))
    first = build_control_table(scheme, build_interlocking(scheme))
    second = build_control_table(scheme, build_interlocking(scheme))
    assert [row.as_dict() for row in first] == [row.as_dict() for row in second]


def test_the_same_plan_exports_the_same_data_twice(plan):
    scheme = build_scheme(load_path(plan))
    assert as_dict(scheme, build_interlocking(scheme)) == as_dict(
        scheme, build_interlocking(scheme)
    )


def test_a_formatted_plan_gives_the_same_routes(plan):
    original = build_scheme(load_path(plan))
    reformatted = build_scheme(load_text(format_scheme(load_path(plan)), source=str(plan)))
    assert [route.name for route in build_interlocking(original).routes()] == [
        route.name for route in build_interlocking(reformatted).routes()
    ]


def test_every_route_holds_track_it_runs_over(plan):
    scheme = build_scheme(load_path(plan))
    for item in build_interlocking(scheme):
        sections = {sub.section for sub in item.track}
        assert sections == set(item.sections)


def test_no_route_holds_the_same_section_twice(plan):
    scheme = build_scheme(load_path(plan))
    for item in build_interlocking(scheme):
        names = [sub.name for sub in item.held_track()]
        assert len(names) == len(set(names))


def test_every_overlap_starts_where_the_route_ends(plan):
    scheme = build_scheme(load_path(plan))
    for item in build_interlocking(scheme):
        for overlap in item.overlaps:
            assert overlap.route == item.name
