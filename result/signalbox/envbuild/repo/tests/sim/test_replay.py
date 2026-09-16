import pytest

from signalbox.sim.replay import Moment, Replay
from signalbox.sim.train import Train
from signalbox.sim.world import build_world
from signalbox.topology.position import Position
from signalbox.units import Distance, Speed


@pytest.fixture
def run(kingsmoor):
    world = build_world(kingsmoor)
    world.add(Train("1A05", Position("D1", Distance(60.0)), speed=Speed.from_mph(20)))
    world.request("K1(M)")
    for _ in range(20):
        world.step(2.0)
    return world


@pytest.fixture
def replay(run):
    return Replay(run.history, run.log)


def test_the_span_is_the_span_of_the_run(replay, run):
    assert replay.span == run.history.span()


def test_a_moment_holds_the_trains_that_were_there(replay):
    moment = replay.at(10.0)
    assert moment.trains == ("1A05",)
    assert moment.fix("1A05") is not None
    assert moment.fix("9Z99") is None


def test_a_moment_before_the_run_has_nothing_in_it(replay):
    assert replay.at(-100.0).fixes == ()


def test_a_moving_train_is_moving(replay):
    moment = replay.at(20.0)
    assert moment.moving() == ("1A05",)
    assert moment.standing() == ()


def test_the_sections_a_moment_covers(replay, run):
    moment = replay.at(10.0)
    assert moment.sections(run.scheme)


def test_moments_can_be_taken_at_an_interval(replay):
    moments = replay.moments(10.0)
    assert len(moments) >= 4
    assert moments[0].at <= moments[-1].at


def test_an_interval_of_nothing_is_refused(replay):
    with pytest.raises(ValueError, match="positive interval"):
        replay.moments(0.0)


def test_events_are_gathered_against_the_moment_they_happened(replay):
    found = [moment for moment in replay.moments(2.0) if moment.events]
    assert found


def test_when_a_train_stopped_can_be_asked_for(kingsmoor):
    world = build_world(kingsmoor)
    world.add(Train("1A05", Position("D1", Distance(60.0)), speed=Speed.from_mph(20)))
    for _ in range(40):
        world.step(2.0)
    replay = Replay(world.history, world.log)
    assert replay.when_train_stopped("1A05")
    assert replay.when_train_stopped("9Z99") == []


def test_the_replay_summarises_itself(replay):
    summary = replay.summary()
    assert "fixes and" in summary
    assert "events" in summary


def test_moments_print_readably():
    assert str(Moment(12.0)) == "12s: 0 trains, 0 events"


def test_a_replay_without_a_log_still_works(run):
    replay = Replay(run.history)
    assert replay.at(10.0).events == ()
    assert "0 events" in replay.summary()


def test_a_creeping_train_counts_as_standing(replay):
    from signalbox.sim.history import Fix
    from signalbox.units import AT_A_STAND

    moment = replay.at(replay.span[1])
    creeping = Fix(0.0, "9Z99", moment.fixes[0].position, Speed(AT_A_STAND))
    assert creeping.speed.stopped


def test_moving_and_standing_together_account_for_everyone(replay):
    for moment in replay.moments(10.0):
        assert len(moment.moving()) + len(moment.standing()) == len(moment.fixes)
