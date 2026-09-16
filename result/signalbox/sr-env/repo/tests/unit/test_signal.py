import pytest

from signalbox.errors import InterlockingError
from signalbox.signalling.signal import Aspect, Signal, SignalType
from signalbox.topology.position import Position
from signalbox.units import Distance


def post(name="K12", heads=3, **kwargs):
    return Signal(name, Position("E1", Distance(100.0)), heads=heads, **kwargs)


def test_aspects_are_ordered_worst_first():
    assert (
        Aspect.RED.value < Aspect.YELLOW.value < Aspect.DOUBLE_YELLOW.value < Aspect.GREEN.value
    )


def test_stop_and_proceed():
    assert Aspect.RED.is_stop and not Aspect.RED.is_proceed
    assert Aspect.YELLOW.is_proceed and not Aspect.YELLOW.is_stop


def test_stepping_up_and_down_saturates():
    assert Aspect.RED.less_restrictive() is Aspect.YELLOW
    assert Aspect.GREEN.less_restrictive() is Aspect.GREEN
    assert Aspect.YELLOW.more_restrictive() is Aspect.RED
    assert Aspect.RED.more_restrictive() is Aspect.RED


def test_aspects_print_the_way_they_are_written_on_a_diagram():
    assert [str(a) for a in Aspect] == ["R", "Y", "YY", "G"]


def test_three_aspect_signal_cannot_show_double_yellow():
    signal = post(heads=3)
    assert not signal.can_show(Aspect.DOUBLE_YELLOW)
    assert signal.can_show(Aspect.YELLOW)
    assert signal.best_aspect is Aspect.GREEN


def test_two_aspect_signal_only_has_red_and_green():
    assert post(heads=2).available == (Aspect.RED, Aspect.GREEN)


def test_clamp_drops_to_the_nearest_available_aspect():
    assert post(heads=3).clamp(Aspect.DOUBLE_YELLOW) is Aspect.YELLOW
    assert post(heads=2).clamp(Aspect.YELLOW) is Aspect.RED
    assert post(heads=4).clamp(Aspect.DOUBLE_YELLOW) is Aspect.DOUBLE_YELLOW


def test_signal_types_know_what_they_may_carry():
    assert SignalType.MAIN.carries_main_routes
    assert not SignalType.SHUNT.carries_main_routes
    assert SignalType.BANNER_REPEATER.is_running_signal


def test_a_shunt_signal_must_be_two_aspect():
    with pytest.raises(InterlockingError, match="two aspect"):
        post(heads=3, type=SignalType.SHUNT)
    post(heads=2, type=SignalType.SHUNT)


def test_five_aspect_signals_are_refused():
    with pytest.raises(InterlockingError, match="expected 2, 3 or 4"):
        post(heads=5)


def test_only_main_signals_can_be_automatic():
    with pytest.raises(InterlockingError, match="cannot be an automatic"):
        post(heads=2, type=SignalType.SHUNT, automatic=True)
    post(automatic=True)


def test_signal_reports_the_edge_it_stands_on():
    assert post().edge == "E1"
    assert str(post()) == "K12"
