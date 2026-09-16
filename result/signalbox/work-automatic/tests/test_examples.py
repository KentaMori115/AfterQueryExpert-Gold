"""Every example scheme has to load, verify and pack.

The examples are the documentation that cannot go stale, so they are tested like
anything else. A change that breaks one of them has broken something a reader
was told to copy.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from signalbox.interchange.json_io import dumps, loads
from signalbox.layout.format import format_scheme
from signalbox.layout.loader import load_path, load_text
from signalbox.render.svg import render_svg
from signalbox.signalling.interlocking import build_interlocking
from signalbox.tables.control_table import build_control_table
from signalbox.topology.scheme import build_scheme
from signalbox.verify import checks as _checks  # noqa: F401
from signalbox.verify.rules import Context, run

EXAMPLES = sorted((Path(__file__).parent.parent / "examples").glob("*.sbx"))


@pytest.fixture(params=EXAMPLES, ids=lambda path: path.stem)
def example(request):
    return build_scheme(load_path(request.param))


def test_there_are_examples_to_test():
    assert EXAMPLES


def test_an_example_loads_and_describes_itself(example):
    assert example.area
    assert len(example.graph.edges) > 0


def test_an_example_has_routes(example):
    assert len(build_interlocking(example)) > 0


def test_an_example_produces_a_control_table(example):
    table = build_control_table(example, build_interlocking(example))
    assert len(table) == len(build_interlocking(example))


def test_an_example_exports_and_reads_back(example):
    text = dumps(example, build_interlocking(example))
    assert loads(text)["scheme"]["area"] == example.area


def test_an_example_draws(example):
    assert render_svg(example).startswith("<svg")


def test_an_example_survives_being_formatted(example, request):
    path = request.node.callspec.params["example"]
    once = format_scheme(load_path(path))
    twice = format_scheme(load_text(once, source=str(path)))
    assert once == twice


def test_an_example_keeps_its_signals_when_formatted(example, request):
    path = request.node.callspec.params["example"]
    formatted = build_scheme(load_text(format_scheme(load_path(path)), source=str(path)))
    assert sorted(formatted.signals) == sorted(example.signals)


def test_an_example_has_no_unprotected_flanks(example):
    context = Context.build(example)
    report = run(context, only=["flank-open"])
    assert report.clean, [str(finding) for finding in report]


def test_an_example_detects_all_of_its_track(example):
    context = Context.build(example)
    assert run(context, only=["detection-gap"]).clean


def test_an_example_can_reach_all_of_its_track(example):
    context = Context.build(example)
    assert run(context, only=["layout-stranded"]).clean


def test_an_example_has_no_route_errors(example):
    context = Context.build(example)
    assert run(context, only=["route-none", "locking-headon", "locking-split"]).clean


def test_an_example_can_be_simulated(example):
    from signalbox.sim.machine import Machine
    from signalbox.sim.world import World

    world = World(example, Machine(example, build_interlocking(example)))
    world.step(5.0)
    assert world.clock == 5.0


def test_every_route_in_an_example_can_be_set(example):
    from signalbox.sim.machine import Machine

    interlocking = build_interlocking(example)
    for plan in interlocking:
        machine = Machine(example, interlocking)
        outcome = machine.request(plan.name)
        assert outcome, f"{plan.name}: {outcome.reason}"


def test_an_example_has_a_headway(example):
    from signalbox.signalling.headway import legs, summarise

    assert summarise(legs(example, build_interlocking(example)))
