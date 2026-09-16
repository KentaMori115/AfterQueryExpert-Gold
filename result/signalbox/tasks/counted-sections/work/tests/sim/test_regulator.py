import pytest

from signalbox.sim.regulator import (
    CLOSE_ENOUGH,
    PATIENCE,
    Candidate,
    Class,
    Regulator,
)
from signalbox.units import Distance


@pytest.fixture
def regulator():
    return Regulator()


def candidate(train, klass=Class.STOPPER, waiting=0.0, distance=100.0):
    return Candidate(train, f"{train}-route", klass, waiting, Distance(distance))


def test_classes_are_ordered_worst_first():
    assert Class.FREIGHT.value < Class.STOPPER.value < Class.EXPRESS.value


def test_a_stopper_is_the_one_that_costs_to_stop():
    assert not Class.STOPPER.keeps_moving
    assert Class.EXPRESS.keeps_moving


def test_classes_are_looked_up_by_word():
    assert Class.from_word("express") is Class.EXPRESS
    assert Class.from_word("EXPRESS") is Class.EXPRESS
    assert Class.from_word("sleeper") is None
    assert str(Class.FREIGHT) == "freight"


def test_a_train_that_has_waited_long_enough_is_impatient():
    assert candidate("1A05", waiting=PATIENCE).impatient
    assert not candidate("1A05", waiting=10.0).impatient


def test_a_train_close_by_is_close():
    assert candidate("1A05", distance=100.0).close
    assert not candidate("1A05", distance=CLOSE_ENOUGH.metres + 1).close


def test_a_lone_request_goes_first(regulator):
    one = candidate("1A05")
    assert regulator.first([one]) is one
    assert regulator.first([]) is None


def test_an_express_close_behind_goes_before_a_stopper(regulator):
    stopper = candidate("2B10", Class.STOPPER, waiting=20.0)
    express = candidate("1A05", Class.EXPRESS, waiting=0.0, distance=500.0)
    assert regulator.first([stopper, express]).train == "1A05"


def test_an_express_a_long_way_off_does_not_hold_anybody_up(regulator):
    stopper = candidate("2B10", Class.STOPPER, waiting=20.0)
    express = candidate("1A05", Class.EXPRESS, distance=9000.0)
    assert regulator.first([stopper, express]).train == "2B10"


def test_a_train_that_has_waited_too_long_goes_first(regulator):
    patient = candidate("6M12", Class.FREIGHT, waiting=PATIENCE + 10)
    express = candidate("1A05", Class.EXPRESS, distance=500.0)
    assert regulator.first([patient, express]).train == "6M12"


def test_between_equals_the_nearer_one_goes_first(regulator):
    near = candidate("2B10", distance=100.0)
    far = candidate("2C20", distance=900.0)
    assert regulator.first([near, far]).train == "2B10"


def test_the_order_is_stable_for_identical_requests(regulator):
    first = candidate("2B10")
    second = candidate("2A10")
    assert [c.train for c in regulator.order([first, second])] == ["2A10", "2B10"]


def test_a_shorter_patience_lets_the_waiting_train_through():
    stopper = candidate("2B10", Class.STOPPER, waiting=30.0)
    express = candidate("1A05", Class.EXPRESS, distance=500.0)
    assert Regulator(patience=10.0).first([stopper, express]).train == "2B10"


def test_the_regulator_describes_its_order(regulator):
    assert regulator.describe([]) == "nothing waiting"
    order = regulator.describe([candidate("2B10"), candidate("1A05", Class.EXPRESS)])
    assert order == "1A05 then 2B10"


def test_candidates_print_readably():
    text = str(candidate("1A05", Class.EXPRESS, waiting=45.0))
    assert text == "1A05 for 1A05-route (express, waiting 45s)"
