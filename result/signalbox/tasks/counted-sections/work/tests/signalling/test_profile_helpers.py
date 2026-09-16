import pytest

from signalbox.layout.loader import load_path
from signalbox.signalling.interlocking import build_interlocking
from signalbox.signalling.profile_helpers import (
    falls_towards_the_signal,
    overlap_profile,
    route_profile,
)
from signalbox.topology.scheme import build_scheme


@pytest.fixture
def lock(kingsmoor):
    return build_interlocking(kingsmoor)


def test_a_route_has_a_profile(kingsmoor, lock):
    shape = route_profile(kingsmoor, lock.plan("K1(M)"))
    assert len(shape) == len(lock.plan("K1(M)").route.edges)


def test_the_profile_covers_the_length_of_the_route(kingsmoor, lock):
    shape = route_profile(kingsmoor, lock.plan("K3(MA)"))
    assert shape.length.metres > 0


def test_a_route_over_a_falling_gradient_falls(kingsmoor, lock):
    shape = route_profile(kingsmoor, lock.plan("K3(MA)"))
    assert shape.rise < 0


def test_an_overlap_has_a_profile_too(kingsmoor, lock):
    assert len(overlap_profile(kingsmoor, lock.plan("K1(M)"))) > 0


def test_a_route_with_no_overlap_has_an_empty_profile(kingsmoor, lock):
    assert len(overlap_profile(kingsmoor, lock.plan("K5(M)"))) == 0


def test_a_route_falling_into_its_signal_is_found(kingsmoor, lock):
    assert falls_towards_the_signal(kingsmoor, lock.plan("K3(MA)"))


def test_a_route_on_the_level_does_not_fall(kingsmoor, lock):
    assert not falls_towards_the_signal(kingsmoor, lock.plan("K1(M)"))


def test_every_route_in_every_example_can_be_profiled():
    from pathlib import Path

    for plan in sorted(Path("examples").glob("*.sbx")):
        scheme = build_scheme(load_path(plan))
        for item in build_interlocking(scheme):
            assert route_profile(scheme, item) is not None
