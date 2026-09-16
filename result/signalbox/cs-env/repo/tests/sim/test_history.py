import pytest

from signalbox.sim.history import Fix, History
from signalbox.sim.train import Train
from signalbox.sim.world import build_world
from signalbox.topology.position import Position
from signalbox.units import Distance, Speed


@pytest.fixture
def world(kingsmoor):
    return build_world(kingsmoor)


def fix(at, train="1A05", offset=100.0, mph=0.0):
    return Fix(at, train, Position("D1", Distance(offset)), Speed.from_mph(mph))


def test_an_empty_history_is_falsy():
    history = History()
    assert not history
    assert len(history) == 0
    assert history.span() == (0.0, 0.0)
    assert history.summary() == "nothing recorded"


def test_fixes_come_back_in_order():
    history = History()
    for at in (0.0, 10.0, 20.0):
        history.record(at, "1A05", Position("D1", Distance(at)), Speed(0.0))
    assert [f.at for f in history] == [0.0, 10.0, 20.0]
    assert history.span() == (0.0, 20.0)


def test_trains_are_listed_in_name_order():
    history = History()
    history.record(0.0, "2B10", Position("D1", Distance(0.0)), Speed(0.0))
    history.record(0.0, "1A05", Position("D1", Distance(0.0)), Speed(0.0))
    assert history.trains() == ["1A05", "2B10"]


def test_fixes_can_be_asked_for_by_train():
    history = History()
    history.record(0.0, "1A05", Position("D1", Distance(0.0)), Speed(0.0))
    history.record(0.0, "2B10", Position("U1", Distance(0.0)), Speed(0.0))
    assert [f.edge for f in history.of("1A05")] == ["D1"]
    assert history.of("9Z99") == []


def test_the_state_at_a_moment_is_the_last_fix_before_it():
    history = History()
    for at in (0.0, 10.0, 20.0):
        history.record(at, "1A05", Position("D1", Distance(at)), Speed(0.0))
    assert [f.at for f in history.at(15.0)] == [10.0]
    assert history.at(-1.0) == []


def test_stops_are_where_a_moving_train_came_to_a_stand():
    history = History()
    history.fixes.extend([fix(0.0, mph=30), fix(10.0, mph=10), fix(20.0, mph=0)])
    assert [f.at for f in history.stops("1A05")] == [20.0]


def test_a_train_that_never_moved_never_stopped():
    history = History()
    history.fixes.extend([fix(0.0), fix(10.0)])
    assert history.stops("1A05") == []


def test_a_fix_knows_its_mileage_when_the_scheme_has_one():
    from signalbox.layout.loader import load_path
    from signalbox.topology.chainage import chainage
    from signalbox.topology.scheme import build_scheme

    scheme = build_scheme(load_path("tests/data/netherby-mileage.sbx"))
    marks = chainage(scheme)
    one = Fix(0.0, "1A05", Position("NE1", Distance(100.0)), Speed(0.0))
    assert one.distance(scheme, marks) is not None


def test_a_fix_has_no_mileage_when_the_scheme_has_none(kingsmoor):
    from signalbox.topology.chainage import chainage

    one = Fix(0.0, "1A05", Position("D1", Distance(100.0)), Speed(0.0))
    assert one.distance(kingsmoor, chainage(kingsmoor)) is None


def test_the_world_records_a_fix_when_a_train_is_put_on(world):
    world.add(Train("1A05", Position("D1", Distance(60.0))))
    assert len(world.history) == 1
    assert world.history.trains() == ["1A05"]


def test_the_world_records_a_fix_every_step(world):
    world.add(Train("1A05", Position("D1", Distance(60.0))))
    world.step(2.0)
    world.step(2.0)
    assert len(world.history) == 3
    assert world.history.span() == (0.0, 4.0)


def test_the_history_summarises_itself(world):
    world.add(Train("1A05", Position("D1", Distance(60.0))))
    world.step(2.0)
    assert "fixes for 1 trains" in world.history.summary()


def test_fixes_print_readably():
    assert str(fix(12.0, mph=45)) == "   12.0s 1A05 at D1->100m doing 45 mph"


def test_a_stop_is_recorded_at_the_threshold_not_at_zero():
    from signalbox.units import AT_A_STAND

    history = History()
    history.fixes.extend([fix(0.0, mph=30), fix(10.0, mph=0)])
    history.fixes.append(Fix(20.0, "1A05", Position("D1", Distance(100.0)), Speed(AT_A_STAND)))
    assert [f.at for f in history.stops("1A05")] == [10.0]


def test_a_train_that_never_quite_stops_never_stopped():
    history = History()
    history.fixes.extend([fix(0.0, mph=30), fix(10.0, mph=1)])
    assert history.stops("1A05") == []
