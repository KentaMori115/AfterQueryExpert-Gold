import pytest

from signalbox.errors import InterlockingError
from signalbox.layout.ast import NodeDecl, NodeKind
from signalbox.signalling.points import (
    DEFAULT_THROW,
    Motor,
    PointsMachine,
    machine_from,
    setting_time,
    slowest,
)
from signalbox.topology.scheme import scheme_from_text


def decl(name="P101", **attributes):
    return NodeDecl(name, NodeKind.POINTS, 0, {k: str(v) for k, v in attributes.items()})


def test_a_bare_declaration_gives_the_default_machine():
    machine = machine_from(decl())
    assert machine.throw == DEFAULT_THROW
    assert machine.motor is Motor.ELECTRIC
    assert machine.locked and machine.detected


def test_settings_are_read_off_the_declaration():
    machine = machine_from(decl(throw=14, motor="hydraulic", lock="no", detection="no"))
    assert machine.throw == 14.0
    assert machine.motor is Motor.HYDRAULIC
    assert not machine.locked
    assert not machine.detected


def test_a_slow_machine_is_flagged():
    assert machine_from(decl(throw=20)).is_slow
    assert not machine_from(decl(throw=6)).is_slow


def test_hand_points_cannot_be_called_from_the_box():
    assert not machine_from(decl(motor="hand")).can_be_called
    assert machine_from(decl()).can_be_called


def test_motors_are_looked_up_by_word():
    assert Motor.from_word("hand") is Motor.HAND
    assert Motor.from_word("steam") is None


def test_a_nonsense_throw_time_is_refused():
    with pytest.raises(InterlockingError, match="throw time of 'soon'"):
        machine_from(decl(throw="soon"))
    with pytest.raises(InterlockingError, match="cannot throw in"):
        machine_from(decl(throw=0))


def test_an_unknown_motor_is_refused():
    with pytest.raises(InterlockingError, match="unknown motor 'steam'"):
        machine_from(decl(motor="steam"))


def test_only_things_that_move_have_machines():
    with pytest.raises(InterlockingError, match="not something that can be moved"):
        machine_from(NodeDecl("A", NodeKind.BOUNDARY))


def test_a_slip_has_a_machine_like_points():
    found = machine_from(NodeDecl("X", NodeKind.SLIP, 0, {"throw": "9"}))
    assert found.throw == 9.0


def test_the_machine_describes_itself():
    assert str(machine_from(decl())) == "P101: electric, 6.0s, locked"
    assert machine_from(decl(lock="no", detection="no")).describe() == (
        "electric, 6.0s, no detection"
    )


def test_the_slowest_machine_is_found():
    machines = {
        "P1": PointsMachine("P1", throw=6.0),
        "P2": PointsMachine("P2", throw=11.0),
    }
    assert slowest(machines).name == "P2"
    assert slowest({}) is None


def test_setting_time_is_the_slowest_not_the_sum():
    machines = {
        "P1": PointsMachine("P1", throw=6.0),
        "P2": PointsMachine("P2", throw=11.0),
    }
    assert setting_time(machines, ["P1", "P2"]) == 11.0
    assert setting_time(machines, ["P1"]) == 6.0
    assert setting_time(machines, []) == 0.0
    assert setting_time(machines, ["P9"]) == 0.0


def test_a_scheme_builds_a_machine_for_every_set_of_points(kingsmoor):
    assert sorted(kingsmoor.machines) == kingsmoor.graph.points()
    assert kingsmoor.machine("P101").throw == DEFAULT_THROW


def test_settings_in_the_plan_reach_the_machine():
    scheme = scheme_from_text("""
    node A boundary
    node P1 points throw 13 motor hydraulic
    node B boundary
    node C boundary
    edge E1 from A to P1.toe length 100
    edge E2 from P1.normal to B length 100
    edge E3 from P1.reverse to C length 100
    """)
    assert scheme.machine("P1").throw == 13.0
    assert scheme.machine("P1").is_slow


def test_an_unknown_set_of_points_is_reported(kingsmoor):
    with pytest.raises(InterlockingError, match="no points called P9"):
        kingsmoor.machine("P9")
