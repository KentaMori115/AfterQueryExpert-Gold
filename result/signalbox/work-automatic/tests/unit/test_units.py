import math

import pytest

from signalbox.errors import UnitError
from signalbox.units import AT_A_STAND, Distance, Gradient, Speed, mileage


def test_miles_chains_round_trip():
    d = Distance.from_miles_chains(12, 34.0)
    miles, chains = d.as_miles_chains()
    assert miles == 12
    assert chains == pytest.approx(34.0)


def test_parse_accepts_the_three_written_forms():
    assert mileage("12m 34ch").metres == pytest.approx(
        Distance.from_miles_chains(12, 34).metres
    )
    assert mileage("34ch").metres == pytest.approx(Distance.from_miles_chains(0, 34).metres)
    assert mileage("12m").metres == pytest.approx(Distance.from_miles_chains(12, 0).metres)


def test_parse_rejects_nonsense():
    with pytest.raises(UnitError):
        mileage("somewhere near the bridge")
    with pytest.raises(UnitError):
        mileage("")


def test_chains_must_be_under_eighty():
    with pytest.raises(UnitError):
        Distance.from_miles_chains(1, 80.0)


def test_a_chain_is_sixty_six_feet():
    assert Distance.from_miles_chains(0, 1).yards == pytest.approx(22.0)


def test_distance_arithmetic():
    a = Distance.from_yards(100)
    b = Distance.from_yards(40)
    assert (a - b).yards == pytest.approx(60)
    assert (a + b).yards == pytest.approx(140)
    assert (b * 2).yards == pytest.approx(80)
    assert abs(b - a).yards == pytest.approx(60)


def test_speed_conversion():
    assert Speed.from_mph(60).mps == pytest.approx(26.8224)
    assert str(Speed.from_mph(75)) == "75 mph"


def test_negative_speed_is_refused():
    with pytest.raises(UnitError):
        Speed.from_mph(-1)


def test_gradient_parsing():
    assert Gradient.parse("1 in 100").per_mille == pytest.approx(10.0)
    assert Gradient.parse("1 in -200").rising is False
    assert math.isinf(Gradient.parse("level").one_in)
    with pytest.raises(UnitError):
        Gradient.parse("1 in 0")


def test_distance_str_is_a_mileage():
    assert str(Distance.from_miles_chains(3, 12.5)) == "3m 12.50ch"


def test_a_train_doing_nothing_is_not_moving():
    assert Speed(0.0).stopped
    assert not Speed(0.0).moving


def test_arithmetic_noise_does_not_count_as_movement():
    assert Speed(0.001).stopped
    assert Speed(AT_A_STAND).stopped


def test_anything_faster_than_the_threshold_is_moving():
    assert Speed(AT_A_STAND * 2).moving
    assert Speed.from_mph(1).moving


def test_moving_and_stopped_are_opposites():
    for mps in (0.0, 0.005, 0.02, 5.0, 40.0):
        assert Speed(mps).moving is not Speed(mps).stopped


def test_the_threshold_is_small_enough_to_be_noise():
    assert Speed.from_mph(1).mps / 10 > AT_A_STAND
