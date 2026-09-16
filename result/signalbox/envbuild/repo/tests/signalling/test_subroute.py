from signalbox.signalling.interlocking import build_interlocking
from signalbox.signalling.subroute import Subroute, ends_for, opposed, shared, subroutes_over
from signalbox.topology.graph import Sense


def test_ends_are_written_ab_or_ba():
    assert ends_for(Sense.NOMINAL) == "AB"
    assert ends_for(Sense.REVERSE) == "BA"


def test_a_subroute_names_its_section_and_direction():
    sub = Subroute("TB", "AB")
    assert sub.name == "TB-AB"
    assert str(sub) == "TB-AB"
    assert sub.reverse == Subroute("TB", "BA")


def test_opposing_and_sharing_are_different_questions():
    ab = Subroute("TB", "AB")
    ba = Subroute("TB", "BA")
    assert ab.opposes(ba)
    assert not ab.opposes(ab)
    assert ab.same_track_as(ba)
    assert not ab.same_track_as(Subroute("TC", "AB"))


def test_subroutes_over_a_run_of_edges(kingsmoor):
    steps = (("D2", Sense.NOMINAL), ("D3", Sense.NOMINAL))
    assert [s.name for s in subroutes_over(kingsmoor, steps)] == ["TB-AB", "TC-AB"]


def test_a_section_spanning_two_edges_appears_once(kingsmoor):
    steps = (("D2", Sense.NOMINAL), ("D2", Sense.NOMINAL))
    assert len(subroutes_over(kingsmoor, steps)) == 1


def test_edges_with_no_section_are_skipped(kingsmoor):
    steps = (("D2", Sense.NOMINAL), ("nowhere", Sense.NOMINAL))
    assert [s.name for s in subroutes_over(kingsmoor, steps)] == ["TB-AB"]


def test_opposed_finds_the_head_on_pairs():
    first = (Subroute("TB", "AB"), Subroute("TC", "AB"))
    second = (Subroute("TC", "BA"),)
    assert opposed(first, second) == ["TC-AB"]
    assert opposed(first, first) == []


def test_shared_ignores_direction():
    first = (Subroute("TB", "AB"),)
    second = (Subroute("TB", "BA"),)
    assert shared(first, second) == ["TB"]
    assert shared(first, ()) == []


def test_plans_carry_their_own_track(kingsmoor):
    plan = build_interlocking(kingsmoor).plan("K1(M)")
    assert [s.name for s in plan.track] == ["TB-AB", "TC-AB"]
    assert [s.name for s in plan.overlap_track] == ["TD-AB", "TE-AB"]
    assert plan.held_track()[-1].name == "TE-AB"


def test_a_following_route_takes_over_the_overlap(kingsmoor):
    lock = build_interlocking(kingsmoor)
    from signalbox.signalling.conflict import conflicts_between

    assert conflicts_between(lock.plan("K1(M)"), lock.plan("K3(MA)")) == []
