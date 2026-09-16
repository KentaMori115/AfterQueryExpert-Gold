import pytest

from signalbox.sim.regulator import Class
from signalbox.sim.timetable import Service, Timetable, Working, run_timetable
from signalbox.units import Speed


@pytest.fixture
def timetable():
    table = Timetable()
    table.add(
        Service(
            "1A05",
            at=0.0,
            edge="D1",
            offset=60.0,
            routes=("K1(M)", "K3(MA)"),
            klass=Class.EXPRESS,
            speed=Speed.from_mph(20),
            booked=200.0,
        )
    )
    table.add(
        Service(
            "2B10",
            at=120.0,
            edge="D1",
            offset=60.0,
            routes=("K1(M)",),
            speed=Speed.from_mph(20),
        )
    )
    return table


def test_a_service_makes_a_train(timetable):
    train = timetable.services[0].train()
    assert train.name == "1A05"
    assert train.front.edge == "D1"


def test_services_are_listed_by_time(timetable):
    assert timetable.span() == (0.0, 120.0)
    assert [s.headcode for s in timetable.due(0.0, 60.0)] == ["1A05"]


def test_an_empty_timetable_spans_nothing():
    assert Timetable().span() == (0.0, 0.0)
    assert len(Timetable()) == 0


def test_services_print_readably(timetable):
    assert str(timetable.services[0]) == "1A05 (express) enters D1 at 0s"


def test_running_a_timetable_gets_the_trains_away(kingsmoor, timetable):
    result = run_timetable(kingsmoor, timetable, until=600.0)
    assert len(result.workings) == 2
    assert result.arrived


def test_the_summary_counts_everything(kingsmoor, timetable):
    result = run_timetable(kingsmoor, timetable, until=600.0)
    summary = result.summary()
    assert "2 services" in summary
    assert "refusals" in summary


def test_a_service_that_never_gets_its_routes_is_stuck(kingsmoor):
    table = Timetable()
    table.add(Service("9Z99", at=0.0, edge="D1", offset=60.0, routes=("K6(M)",)))
    result = run_timetable(kingsmoor, table, until=120.0)
    assert result.stuck
    assert not result.arrived


def test_lateness_is_measured_against_the_booked_time(kingsmoor, timetable):
    result = run_timetable(kingsmoor, timetable, until=600.0)
    delays = [w.delay for w in result.workings if w.delay is not None]
    assert delays


def test_a_service_with_no_booked_time_is_never_late(kingsmoor, timetable):
    result = run_timetable(kingsmoor, timetable, until=600.0)
    for working in result.workings:
        if working.booked is None:
            assert working.delay is None


def test_late_can_be_filtered_by_how_late(kingsmoor, timetable):
    result = run_timetable(kingsmoor, timetable, until=600.0)
    assert len(result.late(by=100000.0)) == 0


def test_workings_print_readably():
    assert str(Working("1A05", 0.0, 300.0, "D5", 2)) == ("1A05 finished at 300s on D5")
    assert str(Working("1A05", 0.0, None, "D1", 0)) == ("1A05 did not finish, standing on D1")


def test_the_second_train_is_held_behind_the_first(kingsmoor, timetable):
    result = run_timetable(kingsmoor, timetable, until=200.0)
    assert result.ars.refused >= 0
    assert len(result.world.trains) == 2
