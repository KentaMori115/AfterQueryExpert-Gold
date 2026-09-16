from signalbox.signalling.berth import (
    Berth,
    Step,
    berth_section,
    berths,
    steps,
    without_berths,
)
from signalbox.signalling.interlocking import build_interlocking
from signalbox.topology.scheme import scheme_from_text
from signalbox.units import Distance


def test_a_signal_berths_in_the_section_behind_it(kingsmoor):
    assert berth_section(kingsmoor, "K1") == "TA"
    assert berth_section(kingsmoor, "K3") == "TC"


def test_an_up_signal_berths_the_other_way(kingsmoor):
    assert berth_section(kingsmoor, "K2") == "TR"
    assert berth_section(kingsmoor, "K4") == "TM"


def test_a_signal_with_nothing_behind_it_has_no_berth():
    scheme = scheme_from_text("""
    node A boundary
    node B boundary
    edge E1 from A to B length 400 direction down
    section TA over E1
    signal S1 on E1 at 0 facing forward direction down
    """)
    assert berth_section(scheme, "S1") is None


def test_the_search_can_be_cut_short(kingsmoor):
    assert berth_section(kingsmoor, "K1", search=Distance(1.0)) == "TA"


def test_every_kingsmoor_signal_has_a_berth(kingsmoor):
    assert without_berths(kingsmoor) == []
    assert len(berths(kingsmoor)) == len(kingsmoor.signals)


def test_berths_come_out_in_signal_order(kingsmoor):
    names = [berth.signal for berth in berths(kingsmoor)]
    assert names == sorted(names)


def test_a_signal_with_no_berth_is_listed():
    scheme = scheme_from_text("""
    node A boundary
    node B boundary
    edge E1 from A to B length 400 direction down
    section TA over E1
    signal S1 on E1 at 0 facing forward direction down
    """)
    assert without_berths(scheme) == ["S1"]


def test_describer_steps_follow_the_routes(kingsmoor):
    found = steps(kingsmoor, build_interlocking(kingsmoor))
    assert Step("TA", "TC", "K1") in found


def test_steps_are_not_repeated(kingsmoor):
    found = steps(kingsmoor, build_interlocking(kingsmoor))
    assert len(found) == len(set(found))


def test_routes_out_of_the_area_make_no_step(kingsmoor):
    found = steps(kingsmoor, build_interlocking(kingsmoor))
    assert all(step.over != "K5" for step in found)


def test_berths_and_steps_print_readably():
    assert str(Berth("K1", "TA")) == "K1 berths in TA"
    assert str(Step("TA", "TC", "K1")) == "TA -> TC past K1"
