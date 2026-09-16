import pytest

from signalbox.errors import InterlockingError
from signalbox.signalling.sighting import (
    READING_TIME,
    SHUNT_READING_TIME,
    Sighting,
    Verdict,
    all_sightings,
    distance_wanted,
    measured,
    short,
    sighting_for,
    unmeasured,
)
from signalbox.topology.scheme import scheme_from_text
from signalbox.units import Distance, Speed

PLAN = """
node A boundary
node B boundary
edge E1 from A to B length 2000 speed 60 direction down
section TA over E1
signal S1 on E1 at 800 facing forward direction down sighting 300
signal S3 on E1 at 1400 facing forward direction down sighting 100
signal S5 on E1 at 1800 facing forward direction down
"""


@pytest.fixture
def scheme():
    return scheme_from_text(PLAN)


def test_the_distance_wanted_follows_line_speed(scheme):
    fast = distance_wanted(Speed.from_mph(90), scheme.signal("S1"))
    slow = distance_wanted(Speed.from_mph(30), scheme.signal("S1"))
    assert fast.metres > slow.metres
    assert fast.metres == pytest.approx(Speed.from_mph(90).mps * READING_TIME)


def test_a_shunt_signal_is_read_from_closer(kingsmoor):
    speed = Speed.from_mph(30)
    main = distance_wanted(speed, kingsmoor.signal("K1"))
    shunt = distance_wanted(speed, kingsmoor.signal("K20"))
    assert shunt.metres < main.metres
    assert shunt.metres == pytest.approx(speed.mps * SHUNT_READING_TIME)


def test_track_with_no_speed_wants_nothing(kingsmoor):
    assert distance_wanted(None, kingsmoor.signal("K1")).metres == 0.0


def test_the_plan_says_what_can_be_seen(scheme):
    assert measured(scheme.signal("S1")).metres == 300.0
    assert measured(scheme.signal("S5")) is None


def test_a_nonsense_sighting_distance_is_refused():
    scheme = scheme_from_text(PLAN.replace("sighting 300", "sighting soon"))
    with pytest.raises(InterlockingError, match="sighting distance of 'soon'"):
        measured(scheme.signal("S1"))


def test_an_adequate_sighting_passes(scheme):
    assert sighting_for(scheme, scheme.signal("S1")).verdict is Verdict.ADEQUATE


def test_a_short_sighting_is_short(scheme):
    found = sighting_for(scheme, scheme.signal("S3"))
    assert found.verdict is Verdict.SHORT
    assert found.verdict.is_a_problem
    assert found.short_by.metres > 0


def test_a_signal_nobody_measured_is_unmeasured(scheme):
    found = sighting_for(scheme, scheme.signal("S5"))
    assert found.verdict is Verdict.UNMEASURED
    assert not found.verdict.is_a_problem
    assert found.short_by.metres == 0.0


def test_all_the_signals_can_be_looked_at(scheme):
    found = all_sightings(scheme)
    assert [one.signal for one in found] == ["S1", "S3", "S5"]
    assert [one.signal for one in short(found)] == ["S3"]
    assert [one.signal for one in unmeasured(found)] == ["S5"]


def test_sightings_describe_themselves(scheme):
    assert "of" in sighting_for(scheme, scheme.signal("S1")).describe()
    assert "never measured" in str(sighting_for(scheme, scheme.signal("S5")))


def test_a_sighting_with_no_speed_is_adequate():
    found = Sighting("S1", Distance(0.0), Distance(0.0), None)
    assert found.verdict is Verdict.ADEQUATE
