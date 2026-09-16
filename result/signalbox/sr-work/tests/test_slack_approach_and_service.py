"""Getting a train down to a restriction, and what one costs the railway.

A slack is only as good as its approach: the braking has to be done on track
that is inside the scheme, at the rate the scheme is drawn to, on the gradient a
train actually meets on its way in. The figures here are worked out longhand
from the same physics rather than asked of the package, so agreement means the
answer is right and not merely consistent with itself.
"""

from __future__ import annotations

import pytest
import signalbox
from signalbox.signalling.headway import legs
from signalbox.signalling.restriction import approach_for
from signalbox.sim.train import Train
from signalbox.sim.world import build_world
from signalbox.topology.position import Position
from signalbox.units import Distance, Speed
from signalbox.verify.report import Severity

#: Metres per second in a mile an hour, and gravity, as the units module holds
#: them. Written out here so the numbers below owe nothing to the code they are
#: checking.
MPH = 0.44704
GRAVITY = 9.80665

DOWN = """
scheme downline {
    area "Down Line"
    prefix D
}

node WD boundary
node J1 plain
node J2 plain
node ED boundary

edge D1 from WD to J1 length 1000 speed 60 direction down
edge D2 from J1 to J2 length 800 speed 60 direction down
edge D3 from J2 to ED length 900 speed 60 direction down

section TA over D1
section TB over D2
section TC over D3

signal K1 on D1 at 990 facing forward direction down aspects 4
signal K3 on D2 at 790 facing forward direction down aspects 4
"""

BANK = """
scheme bank {
    area "Bank"
    prefix B
}

node WD boundary
node J1 plain
node J2 plain
node ED boundary

edge B1 from WD to J1 length 1000 speed 60 gradient 1 in -200 direction down
edge B2 from J1 to J2 length 800 speed 60 direction down
edge B3 from J2 to ED length 900 speed 60 direction down

section TA over B1
section TB over B2
section TC over B3

signal K1 on B1 at 990 facing forward direction down aspects 4
"""

DRAWN_THE_OTHER_WAY = """
scheme reversed {
    area "Reversed"
    prefix R
}

node WD boundary
node J1 plain
node J2 plain
node ED boundary

edge R1 from J1 to WD length 1000 speed 60 gradient 1 in 200 direction bidirectional
edge R2 from J1 to J2 length 800 speed 60 direction bidirectional
edge R3 from J2 to ED length 900 speed 60 direction bidirectional

section TA over R1
section TB over R2
section TC over R3
"""

NEAR_BANK = """
scheme near {
    area "Near"
    prefix N
}

node WD boundary
node J1 plain
node J2 plain
node ED boundary

edge N1 from WD to J1 length 1000 speed 60 direction down
edge N2 from J1 to J2 length 800 speed 60 gradient 1 in -180 direction down
edge N3 from J2 to ED length 900 speed 60 direction down

section TA over N1
section TB over N2
section TC over N3
"""

FAR_BANK = """
scheme far {
    area "Far"
    prefix F
}

node WD boundary
node J1 plain
node J2 plain
node ED boundary

edge F1 from WD to J1 length 1000 speed 60 gradient 1 in -180 direction down
edge F2 from J1 to J2 length 800 speed 60 direction down
edge F3 from J2 to ED length 900 speed 60 direction down

section TA over F1
section TB over F2
section TC over F3
"""

SHORT = """
scheme cramped {
    area "Cramped"
    prefix C
}

node WD boundary
node ED boundary

edge C1 from WD to ED length 700 speed 75 direction down

section TA over C1

signal K1 on C1 at 690 facing forward direction down aspects 4
"""

TIGHT = """
scheme tight {
    area "Tight"
    prefix T
}

node WD boundary
node J1 plain
node ED boundary

edge T1 from WD to J1 length 400 speed 60 direction down
edge T2 from J1 to ED length 900 speed 60 direction down

section TA over T1
section TB over T2

signal K1 on T1 at 0 facing forward direction down aspects 4
signal K3 on T1 at 400 facing forward direction down aspects 4
"""


def plan(text, *extra):
    return signalbox.parse(text + "".join(f"{line}\n" for line in extra))


def approach(scheme, name):
    """The approach worked out for one restriction, however it comes back."""
    return approach_for(scheme, scheme.restriction(name))


def braking_metres(found):
    """How long the braking run is, where an approach with nothing to do may
    equally be an approach of no length or no approach at all."""
    if found is None:
        return 0.0
    return metres(found.distance)


def board_of(found):
    """Where the warning board stands, and nothing where there is no room."""
    if found is None:
        return None
    return found.board


def metres(distance):
    """A distance in metres, whichever way it is held."""
    return distance.metres if hasattr(distance, "metres") else float(distance)


def mph(speed):
    return speed.mph if hasattr(speed, "mph") else float(speed)


def effective(rate, one_in):
    """The braking rate a gradient leaves, floored the way the package floors it."""
    per_mille = 0.0 if one_in is None else 1000.0 / one_in
    return max(rate + GRAVITY * per_mille / 1000.0, 0.05)


def braking_run(stretches, from_mph, to_mph, rate=0.45, reaction=4.0):
    """How far back the board goes, worked stretch by stretch, longhand.

    ``stretches`` is the track in rear of the slack, nearest first, each of them
    a length in metres and the gradient a train meets running towards the slack.
    The train has to be at ``to_mph`` by the first restricted metre, so at the
    far end of each stretch it was doing whatever that stretch leaves it, and
    braking begins where that reaches ``from_mph``. Reaction goes in front.
    """
    fast = from_mph * MPH
    here = to_mph * MPH
    run = 0.0
    for length, one_in in stretches:
        rate_here = effective(rate, one_in)
        reached = (here**2 + 2.0 * rate_here * length) ** 0.5
        if reached >= fast:
            run += (fast**2 - here**2) / (2.0 * rate_here)
            return run + fast * reaction
        run += length
        here = reached
    raise AssertionError("the track given does not hold the whole braking run")


LEVEL_INTO_D2 = ((600.0, None), (1000.0, None))


def findings_about(scheme, code):
    return [f for f in signalbox.check(scheme) if f.rule == code]


def test_the_braking_run_is_as_long_as_the_physics_says():
    scheme = plan(DOWN, "restriction TSR1 on D2 at 600 for 400 speed 20")
    found = approach(scheme, "TSR1")
    assert braking_metres(found) == pytest.approx(braking_run(LEVEL_INTO_D2, 60, 20), abs=0.5)


def test_the_board_stands_that_far_back_from_the_first_metre():
    scheme = plan(DOWN, "restriction TSR1 on D2 at 600 for 400 speed 20")
    found = approach(scheme, "TSR1")
    back = braking_run(LEVEL_INTO_D2, 60, 20) - 600.0
    assert board_of(found).edge == "D1"
    assert metres(board_of(found).offset) == pytest.approx(1000.0 - back, abs=0.5)


def test_a_board_that_fits_stands_on_the_same_piece_of_track():
    scheme = plan(DOWN, "restriction TSR1 on D3 at 850 for 50 speed 45")
    found = approach(scheme, "TSR1")
    assert board_of(found).edge == "D3"
    assert metres(board_of(found).offset) == pytest.approx(850.0 - braking_run(((850.0, None),), 60, 45), abs=0.5)


def test_a_falling_gradient_on_the_approach_lengthens_the_run():
    scheme = plan(BANK, "restriction TSR1 on B2 at 600 for 400 speed 20")
    found = approach(scheme, "TSR1")
    assert braking_metres(found) == pytest.approx(braking_run(((600.0, None), (1000.0, -200.0)), 60, 20), abs=0.5)


def test_the_gradient_is_the_one_a_train_meets_and_not_the_one_written():
    scheme = plan(DRAWN_THE_OTHER_WAY, "restriction TSR1 on R2 at 600 for 200 speed 20")
    found = approach(scheme, "TSR1")
    assert braking_metres(found) == pytest.approx(braking_run(((600.0, None), (1000.0, -200.0)), 60, 20), abs=0.5)


def test_a_bank_next_to_the_slack_is_braked_over_where_it_lies():
    scheme = plan(NEAR_BANK, "restriction TSR1 on N2 at 600 for 200 speed 20")
    found = approach(scheme, "TSR1")
    assert braking_metres(found) == pytest.approx(
        braking_run(((600.0, -180.0), (1000.0, None)), 60, 20), abs=1.0
    )


def test_the_same_bank_further_back_is_worth_less():
    # Same two gradients as the case above, the other way round. A run worked
    # against the worst gradient it meets anywhere cannot tell them apart.
    scheme = plan(FAR_BANK, "restriction TSR1 on F2 at 600 for 200 speed 20")
    found = approach(scheme, "TSR1")
    assert braking_metres(found) == pytest.approx(
        braking_run(((600.0, None), (1000.0, -180.0)), 60, 20), abs=1.0
    )


def test_a_restriction_no_slower_than_the_line_asks_for_no_braking():
    scheme = plan(DOWN, "restriction TSR1 on D2 at 600 for 100 speed 60")
    found = approach(scheme, "TSR1")
    assert braking_metres(found) == pytest.approx(0.0)


def test_a_scheme_with_no_room_gives_no_board():
    scheme = plan(SHORT, "restriction TSR1 on C1 at 200 for 400 speed 15")
    assert board_of(approach(scheme, "TSR1")) is None


def test_the_braking_rate_the_scheme_is_drawn_to_is_the_one_used():
    slower = plan(
        DOWN.replace("prefix D", "prefix D\n}\n\nstandards {\n    braking 0.3"),
        "restriction TSR1 on D2 at 600 for 400 speed 20",
    )
    found = approach(slower, "TSR1")
    assert braking_metres(found) == pytest.approx(braking_run(LEVEL_INTO_D2, 60, 20, rate=0.3), abs=0.5)


def test_the_reaction_time_the_scheme_is_drawn_to_is_the_one_used():
    slower = plan(
        DOWN.replace("prefix D", "prefix D\n}\n\nstandards {\n    reaction 12"),
        "restriction TSR1 on D2 at 600 for 400 speed 20",
    )
    found = approach(slower, "TSR1")
    assert braking_metres(found) == pytest.approx(braking_run(LEVEL_INTO_D2, 60, 20, reaction=12.0), abs=0.5)


def test_a_restriction_with_no_room_to_brake_is_reported():
    scheme = plan(SHORT, "restriction TSR1 on C1 at 200 for 400 speed 15")
    assert [f.subject for f in findings_about(scheme, "restriction-room")] == ["TSR1"]


def test_a_restriction_with_no_room_to_brake_stops_the_scheme_being_approved():
    scheme = plan(SHORT, "restriction TSR1 on C1 at 200 for 400 speed 15")
    found = findings_about(scheme, "restriction-room")
    assert found[0].severity is Severity.ERROR


def test_a_restriction_with_room_to_brake_is_not_reported():
    scheme = plan(DOWN, "restriction TSR1 on D2 at 600 for 400 speed 20")
    assert findings_about(scheme, "restriction-room") == []


def test_a_restriction_that_slows_nothing_is_not_reported():
    scheme = plan(SHORT, "restriction TSR1 on C1 at 200 for 400 speed 75")
    assert findings_about(scheme, "restriction-room") == []


def test_spacing_is_checked_at_the_fastest_a_train_may_be_doing():
    scheme = plan(TIGHT, "restriction TSR1 on T2 at 0 for 900 speed 15")
    assert [f.subject for f in findings_about(scheme, "spacing-short")] != []


def test_a_slack_over_the_whole_block_lowers_what_spacing_asks_for():
    scheme = plan(TIGHT, "restriction TSR1 on T1 at 0 for 400 speed 15")
    assert findings_about(scheme, "spacing-short") == []


def test_a_slack_over_part_of_the_block_leaves_spacing_where_it_was():
    scheme = plan(TIGHT, "restriction TSR1 on T1 at 0 for 200 speed 15")
    assert [f.subject for f in findings_about(scheme, "spacing-short")] != []


def test_headway_is_worked_at_the_slowest_a_train_is_held_to():
    scheme = plan(TIGHT, "restriction TSR1 on T1 at 100 for 100 speed 15")
    found = legs(scheme, signalbox.interlocking(scheme))
    assert min(mph(leg.speed) for leg in found) == pytest.approx(15.0)


def test_a_block_the_slack_does_not_reach_keeps_its_line_speed():
    scheme = plan(DOWN, "restriction TSR1 on D3 at 0 for 900 speed 15")
    found = legs(scheme, signalbox.interlocking(scheme))
    assert [mph(leg.speed) for leg in found] == [pytest.approx(60.0)]


def test_a_driver_is_held_to_the_restricted_speed():
    scheme = plan(DOWN, "restriction TSR1 on D2 at 100 for 300 speed 20")
    world = build_world(scheme)
    train = world.add(
        Train("1A05", Position("D2", Distance(200.0)), max_speed=Speed.from_mph(75))
    )
    assert mph(world.line_speed(train)) == pytest.approx(20.0)


def test_a_driver_off_the_restricted_track_is_held_to_line_speed():
    scheme = plan(DOWN, "restriction TSR1 on D2 at 100 for 300 speed 20")
    world = build_world(scheme)
    train = world.add(
        Train("1A05", Position("D2", Distance(600.0)), max_speed=Speed.from_mph(75))
    )
    assert mph(world.line_speed(train)) == pytest.approx(60.0)


def test_a_restriction_starting_at_a_joint_brakes_from_the_track_it_starts_on():
    scheme = plan(DOWN, "restriction TSR1 on D3 at 0 for 400 speed 20")
    found = approach(scheme, "TSR1")
    assert braking_metres(found) == pytest.approx(
        braking_run(((800.0, None), (1000.0, None)), 60, 20), abs=0.5
    )


def test_the_board_walks_back_over_as_many_pieces_of_track_as_it_takes():
    scheme = plan(DOWN, "restriction TSR1 on D3 at 0 for 400 speed 20")
    found = approach(scheme, "TSR1")
    assert board_of(found).edge == "D1"


def test_one_slack_short_of_room_does_not_condemn_another_that_has_it():
    scheme = plan(
        DOWN,
        "restriction TSR1 on D1 at 20 for 200 speed 15",
        "restriction TSR2 on D3 at 850 for 50 speed 45",
    )
    assert [f.subject for f in findings_about(scheme, "restriction-room")] == ["TSR1"]


def test_the_finding_says_which_restriction_it_is_about():
    scheme = plan(SHORT, "restriction TSR1 on C1 at 200 for 400 speed 15")
    found = findings_about(scheme, "restriction-room")
    assert len(found) == 1 and found[0].subject == "TSR1"


def test_a_train_standing_where_two_slacks_meet_gets_the_slower_one():
    scheme = plan(
        DOWN,
        "restriction TSR1 on D2 at 100 for 500 speed 30",
        "restriction TSR2 on D2 at 300 for 200 speed 15",
    )
    world = build_world(scheme)
    train = world.add(
        Train("1A05", Position("D2", Distance(400.0)), max_speed=Speed.from_mph(75))
    )
    assert mph(world.line_speed(train)) == pytest.approx(15.0)
