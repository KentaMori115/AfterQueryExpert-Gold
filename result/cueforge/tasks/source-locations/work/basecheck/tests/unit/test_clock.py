from cueforge.simulation.clock import VirtualClock


def test_clock_advances_forward() -> None:
    clock = VirtualClock(0)
    clock.advance_to(250)
    assert clock.now_ms == 250


def test_clock_rejects_backward_move() -> None:
    clock = VirtualClock(10)
    try:
        clock.advance_to(5)
    except ValueError:
        return
    raise AssertionError("clock must not move backwards")
