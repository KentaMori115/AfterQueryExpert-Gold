from signalbox.signalling.flank import FlankKind, flanks_for
from signalbox.signalling.interlocking import build_interlocking
from signalbox.topology.scheme import scheme_from_text

SIDING = """
node W boundary
node P1 points
node E boundary
node S buffer
edge M1 from W to P1.toe length 800 speed 60 direction down
edge M2 from P1.normal to E length 600 speed 60 direction down
edge M3 from P1.reverse to S length 300 speed 15 direction bidirectional
section TA over M1
section TB over M2
section TC over M3
signal S1 on M1 at 800 facing forward direction down
{trap}
"""


def flanks_for_route(text, name="S1(MA)"):
    scheme = scheme_from_text(text)
    lock = build_interlocking(scheme)
    plan = lock.plan(name)
    return scheme, flanks_for(scheme, plan.route)


def test_without_a_trap_the_siding_end_is_a_dead_end():
    _scheme, flanks = flanks_for_route(SIDING.format(trap=""))
    assert [flank.kind for flank in flanks] == [FlankKind.DEAD_END]


def test_a_trap_facing_the_running_line_protects_the_flank():
    _scheme, flanks = flanks_for_route(
        SIDING.format(trap="trap TP1 on M3 at 40 facing backward")
    )
    assert [flank.kind for flank in flanks] == [FlankKind.TRAP]
    assert flanks[0].element == "TP1"
    assert flanks[0].requirement() == "TP1 trap"
    assert flanks[0].protected


def test_a_trap_facing_the_other_way_does_not_protect():
    _scheme, flanks = flanks_for_route(
        SIDING.format(trap="trap TP1 on M3 at 40 facing forward")
    )
    assert [flank.kind for flank in flanks] == [FlankKind.DEAD_END]


def test_a_trap_beats_the_things_further_back():
    text = SIDING.format(trap="trap TP1 on M3 at 40 facing backward").replace(
        "node S buffer", "node S boundary"
    )
    _scheme, flanks = flanks_for_route(text)
    assert flanks[0].kind is FlankKind.TRAP


def test_without_the_trap_a_boundary_beyond_the_siding_is_unprotected():
    text = SIDING.format(trap="").replace("node S buffer", "node S boundary")
    _scheme, flanks = flanks_for_route(text)
    assert flanks[0].kind is FlankKind.UNPROTECTED


def test_the_trap_kind_counts_as_protection():
    assert FlankKind.TRAP.is_protection


def test_a_scheme_with_no_traps_is_unaffected(kingsmoor):
    lock = build_interlocking(kingsmoor)
    kinds = {flank.kind for flank in flanks_for(kingsmoor, lock.plan("K1(M)").route)}
    assert FlankKind.TRAP not in kinds
