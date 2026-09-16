"""The checks run against the scheme's own figures, not the package's.

A scheme drawn to a longer overlap should not be reported as short, and one
drawn to a gentler braking rate should be reported for signals that would be
fine at the usual rate. Both come out of the same setting, so both are tested.
"""

from __future__ import annotations

import pytest

from signalbox.signalling.interlocking import build_interlocking
from signalbox.sim.machine import Machine
from signalbox.topology.scheme import scheme_from_text
from signalbox.verify.checks import overlap as _overlap  # noqa: F401
from signalbox.verify.checks import spacing as _spacing  # noqa: F401
from signalbox.verify.rules import Context, run

LINE = """
{standards}
node A boundary
node J1 plain
node J2 plain
node B boundary
edge E1 from A to J1 length 1200 speed 60 direction down
edge E2 from J1 to J2 length 1200 speed 60 direction down
edge E3 from J2 to B length 1200 speed 60 direction down
section TA over E1
section TB over E2
section TC over E3
signal S1 on E1 at 1200 facing forward direction down
signal S3 on E2 at 1200 facing forward direction down
"""


def context_for(standards=""):
    return Context.build(scheme_from_text(LINE.format(standards=standards)))


def test_the_default_overlap_is_used_when_nothing_is_said():
    assert context_for().standard_overlap.metres == 183.0


def test_the_overlap_in_the_plan_is_used():
    context = context_for("standards {\n  overlap 400\n}\n")
    assert context.standard_overlap.metres == 400.0


def test_a_longer_overlap_makes_a_short_one_a_finding():
    lenient = run(context_for(), only=["overlap-short"])
    strict = run(context_for("standards {\n  overlap 2000\n}\n"), only=["overlap-short"])
    assert len(strict) > len(lenient)


def test_the_braking_rate_in_the_plan_is_used():
    context = context_for("standards {\n  braking 0.2\n  reaction 6\n}\n")
    assert context.braking.rate == 0.2
    assert context.braking.reaction == 6.0


def test_a_gentler_braking_rate_makes_spacing_a_finding():
    lenient = run(context_for(), only=["spacing-short"])
    strict = run(context_for("standards {\n  braking 0.05\n}\n"), only=["spacing-short"])
    assert len(strict) > len(lenient)


def test_the_interlocking_uses_the_schemes_overlap():
    scheme = scheme_from_text(LINE.format(standards="standards {\n  overlap 40\n}\n"))
    plan = build_interlocking(scheme).plan("S1(M)")
    assert plan.overlap.length.metres == pytest.approx(40.0)


def test_the_flank_search_comes_from_the_plan():
    scheme = scheme_from_text(LINE.format(standards="standards {\n  flank 10\n}\n"))
    for plan in build_interlocking(scheme):
        for flank in plan.flanks:
            assert flank.distance.metres <= 10.0


def test_the_point_throw_time_comes_from_the_plan(kingsmoor_text):
    from signalbox.layout.loader import load_text
    from signalbox.topology.scheme import build_scheme

    text = "standards {\n  throw 15\n}\n" + kingsmoor_text
    scheme = build_scheme(load_text(text))
    machine = Machine(scheme, build_interlocking(scheme))
    assert machine.throw_time("P101") == 6.0
    scheme.machines.pop("P101")
    assert machine.throw_time("P101") == 15.0


def test_the_approach_delay_floor_comes_from_the_plan():
    from signalbox.signalling.approach import approach_lock_for

    scheme = scheme_from_text(LINE.format(standards="standards {\n  approach 300\n}\n"))
    plan = build_interlocking(scheme).plan("S1(M)")
    assert approach_lock_for(scheme, plan).delay == 300.0


def test_the_route_limit_comes_from_the_plan():
    scheme = scheme_from_text(LINE.format(standards="standards {\n  route_limit 100\n}\n"))
    assert len(build_interlocking(scheme)) == 0
