"""The toolkit has to stay usable on a scheme bigger than the examples.

These are not benchmarks, they are guards. The budgets are loose enough that
they will not trip on a slow machine and tight enough that they will trip if
something turns into an accidental quadratic.
"""

from __future__ import annotations

import time

import pytest

from signalbox.signalling.conflict import build_matrix
from signalbox.signalling.interlocking import build_interlocking
from signalbox.signalling.routefind import all_routes
from signalbox.sim.machine import Machine
from signalbox.tables.control_table import build_control_table
from signalbox.topology.scheme import scheme_from_text

SIGNALS = 120


def long_line(signals: int = SIGNALS) -> str:
    """A plain double track line with a signal every nine hundred metres."""
    parts = ["node A boundary"]
    parts += [f"node J{i} plain" for i in range(signals)]
    parts.append("node B boundary")

    previous = "A"
    for i in range(signals):
        parts.append(f"edge E{i} from {previous} to J{i} length 900 speed 90 direction down")
        parts.append(f"section T{i} over E{i}")
        parts.append(f"signal S{i} on E{i} at 900 facing forward direction down aspects 4")
        previous = f"J{i}"
    parts.append(f"edge E{signals} from {previous} to B length 900 speed 90 direction down")
    parts.append(f"section T{signals} over E{signals}")
    return "\n".join(parts) + "\n"


@pytest.fixture(scope="module")
def big():
    return scheme_from_text(long_line())


def took(function, *args, **kwargs):
    start = time.perf_counter()
    result = function(*args, **kwargs)
    return result, time.perf_counter() - start


def test_a_long_line_parses_quickly():
    _scheme, seconds = took(scheme_from_text, long_line())
    assert seconds < 5.0


def test_route_finding_stays_linear(big):
    routes, seconds = took(all_routes, big)
    assert len(routes) == SIGNALS
    assert seconds < 5.0


def test_the_interlocking_builds_quickly(big):
    interlocking, seconds = took(build_interlocking, big)
    assert len(interlocking) == SIGNALS
    assert seconds < 10.0


def test_the_conflict_matrix_builds_quickly(big):
    interlocking = build_interlocking(big)
    _matrix, seconds = took(build_matrix, interlocking)
    assert seconds < 10.0


def test_the_control_table_builds_quickly(big):
    interlocking = build_interlocking(big)
    table, seconds = took(build_control_table, big, interlocking)
    assert len(table) == SIGNALS
    assert seconds < 15.0


def test_the_signal_index_is_kept(big):
    first, one = took(big.signals_on, "E5")
    second, two = took(big.signals_on, "E5")
    assert [s.name for s in first] == [s.name for s in second]
    assert two <= one + 0.01


def test_the_index_can_be_thrown_away(big):
    big.signals_on("E5")
    big.forget_index()
    assert [s.name for s in big.signals_on("E5")] == ["S5"]


def test_a_simulation_step_is_quick(big):
    machine = Machine(big, build_interlocking(big))
    _nothing, seconds = took(machine.tick, 1.0)
    assert seconds < 2.0


@pytest.mark.slow
def test_setting_every_route_on_a_long_line(big):
    """The budget is loose because this runs under coverage as well."""
    interlocking = build_interlocking(big)
    machine = Machine(big, interlocking)
    start = time.perf_counter()
    for plan in interlocking:
        machine.request(plan.name)
    assert time.perf_counter() - start < 90.0
