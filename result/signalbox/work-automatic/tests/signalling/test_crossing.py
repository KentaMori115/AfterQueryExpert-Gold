import pytest

from signalbox.errors import InterlockingError
from signalbox.layout.ast import CrossingKind
from signalbox.signalling.crossing import (
    Crossing,
    crossings_over,
    interlocked_over,
    requirements_for,
)
from signalbox.signalling.interlocking import build_interlocking
from signalbox.topology.position import Position
from signalbox.topology.scheme import scheme_from_text
from signalbox.units import Distance, Speed

PLAN = """
node A boundary
node B boundary
node J plain
edge E1 from A to J length 800 speed 60 direction down
edge E2 from J to B length 800 speed 60 direction down
section TA over E1
section TB over E2
signal S1 on E1 at 200 facing forward direction down
signal S3 on E2 at 400 facing forward direction down
crossing LC21 on E1 at 500 type mcb strike_in 30
crossing LC23 on E2 at 200 type ahb
crossing LC25 on E1 at 100 type uwc
"""


@pytest.fixture
def scheme():
    return scheme_from_text(PLAN)


@pytest.fixture
def lock(scheme):
    return build_interlocking(scheme)


def test_crossings_are_built_from_the_plan(scheme):
    assert sorted(scheme.crossings) == ["LC21", "LC23", "LC25"]
    assert scheme.crossing("LC21").strike_in == 30.0
    assert scheme.crossing("LC23").kind is CrossingKind.AUTOMATIC_HALF


def test_an_unknown_crossing_is_reported(scheme):
    with pytest.raises(InterlockingError, match="no crossing called LC99"):
        scheme.crossing("LC99")


def test_crossings_on_an_edge_come_out_in_order(scheme):
    assert [c.name for c in scheme.crossings_on("E1")] == ["LC25", "LC21"]
    assert scheme.crossings_on("E2") == [scheme.crossing("LC23")]


def test_a_route_finds_the_crossings_it_runs_over(scheme, lock):
    over = crossings_over(scheme, lock.plan("S1(M)"))
    assert [c.name for c in over] == ["LC21", "LC23"]


def test_a_crossing_behind_the_signal_is_not_on_the_route(scheme, lock):
    assert "LC25" not in [c.name for c in crossings_over(scheme, lock.plan("S1(M)"))]


def test_a_crossing_beyond_the_exit_signal_is_not_on_the_route(scheme, lock):
    over = crossings_over(scheme, lock.plan("S3(M)"))
    assert [c.name for c in over] == []


def test_only_the_interlocked_ones_have_to_be_proved(scheme, lock):
    assert [c.name for c in interlocked_over(scheme, lock.plan("S1(M)"))] == ["LC21"]


def test_the_requirements_read_as_a_column(scheme, lock):
    assert requirements_for(scheme, lock.plan("S1(M)")) == (
        "LC21 barriers down",
        "LC23 strike in only",
    )


def test_each_kind_has_its_own_requirement():
    def crossing(kind):
        return Crossing("LC1", Position("E1", Distance(10.0)), kind)

    assert crossing(CrossingKind.OBSTACLE_DETECTED).requirement().endswith("road clear")
    assert crossing(CrossingKind.USER_WORKED).requirement().endswith("telephone")
    assert crossing(CrossingKind.OPEN).requirement().endswith("nothing")


def test_the_strike_in_distance_grows_with_speed():
    crossing = Crossing("LC1", Position("E1", Distance(10.0)), strike_in=30.0)
    assert crossing.strike_in_distance(Speed.from_mph(60)).metres == pytest.approx(
        Speed.from_mph(60).mps * 30.0
    )


def test_a_crossing_prints_where_it_is():
    crossing = Crossing("LC21", Position("E1", Distance(500.0)))
    assert str(crossing) == "LC21 (mcb) on E1->500m"
    assert crossing.edge == "E1"
    assert crossing.interlocked


def test_a_scheme_with_no_crossings_has_none(kingsmoor):
    assert kingsmoor.crossings == {}
    assert crossings_over(kingsmoor, build_interlocking(kingsmoor).plan("K1(M)")) == []
