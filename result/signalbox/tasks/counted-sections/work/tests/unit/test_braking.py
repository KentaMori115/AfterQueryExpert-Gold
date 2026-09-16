import pytest

from signalbox.signalling.braking import (
    REACTION_SECONDS,
    SERVICE_BRAKING,
    BrakingModel,
    headway_seconds,
    required_spacing,
)
from signalbox.units import Distance, Gradient, Speed


@pytest.fixture
def model():
    return BrakingModel()


def test_level_stopping_distance_is_reaction_plus_braking(model):
    speed = Speed.from_mph(60)
    expected = speed.mps * REACTION_SECONDS + speed.mps**2 / (2 * SERVICE_BRAKING)
    assert model.stopping_distance(speed).metres == pytest.approx(expected)


def test_a_rising_gradient_shortens_the_distance(model):
    speed = Speed.from_mph(75)
    level = model.stopping_distance(speed)
    uphill = model.stopping_distance(speed, Gradient.parse("1 in 100"))
    assert uphill.metres < level.metres


def test_a_falling_gradient_lengthens_the_distance(model):
    speed = Speed.from_mph(75)
    level = model.stopping_distance(speed)
    downhill = model.stopping_distance(speed, Gradient.parse("1 in -100"))
    assert downhill.metres > level.metres


def test_a_savage_falling_gradient_does_not_give_an_infinite_distance(model):
    distance = model.stopping_distance(Speed.from_mph(60), Gradient.parse("1 in -20"))
    assert distance.metres < 20000


def test_the_effective_rate_is_floored(model):
    assert model.effective_rate(Gradient.parse("1 in -5")) == pytest.approx(0.05)


def test_speed_after_braking_falls(model):
    speed = Speed.from_mph(60)
    slower = model.speed_after(speed, Distance(200.0))
    assert 0 < slower.mps < speed.mps


def test_braking_far_enough_brings_a_train_to_a_stand(model):
    assert model.speed_after(Speed.from_mph(60), Distance(5000.0)).mps == 0.0


def test_time_to_stop_includes_the_reaction(model):
    speed = Speed.from_mph(45)
    assert model.time_to_stop(speed) == pytest.approx(
        REACTION_SECONDS + speed.mps / SERVICE_BRAKING
    )


def test_four_aspect_blocks_are_half_the_braking_distance(model):
    speed = Speed.from_mph(90)
    full = model.stopping_distance(speed)
    assert required_spacing(speed, 4).metres == pytest.approx(full.metres / 2)


def test_three_aspect_blocks_hold_the_whole_braking_distance(model):
    speed = Speed.from_mph(90)
    assert required_spacing(speed, 3).metres == pytest.approx(
        model.stopping_distance(speed).metres
    )


def test_two_aspect_signals_want_more_room_still():
    speed = Speed.from_mph(40)
    assert required_spacing(speed, 2).metres > required_spacing(speed, 3).metres


def test_spacing_honours_the_gradient():
    speed = Speed.from_mph(75)
    down = required_spacing(speed, 4, gradient=Gradient.parse("1 in -150"))
    up = required_spacing(speed, 4, gradient=Gradient.parse("1 in 150"))
    assert down.metres > up.metres


def test_a_gentler_braking_rate_needs_longer_blocks():
    speed = Speed.from_mph(75)
    slack = BrakingModel(rate=0.3)
    assert required_spacing(speed, 4, model=slack).metres > required_spacing(speed, 4).metres


def test_headway_counts_two_blocks_on_four_aspect():
    four = headway_seconds(Speed.from_mph(90), Distance(1200.0), Distance(200.0), heads=4)
    three = headway_seconds(Speed.from_mph(90), Distance(1200.0), Distance(200.0), heads=3)
    assert four > three


def test_headway_at_a_stand_is_refused():
    with pytest.raises(ValueError, match="at a stand"):
        headway_seconds(Speed(0.0), Distance(1000.0), Distance(200.0))
