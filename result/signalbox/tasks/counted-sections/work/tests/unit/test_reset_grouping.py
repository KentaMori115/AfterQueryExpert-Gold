"""Counting heads and reset zones, read back out of the interchange file.

Everything here goes through what the toolkit already publishes: the section
records in the interchange file and the locking the interlocking works out. The
layouts are small on purpose, each one isolating a single decision about where
a head is wanted or what has to be reset alongside what.
"""

from __future__ import annotations

import json
import pathlib

from signalbox.interchange.json_io import dumps
from signalbox.signalling.conflict import build_matrix
from signalbox.signalling.interlocking import build_interlocking
from signalbox.signalling.locking import Release, build_locking
from signalbox.tables.locking_table import build_locking_report
from signalbox.topology.scheme import scheme_from_text

PLAIN_PAIR = """
node A boundary
node J1 plain
node B boundary
edge E1 from A to J1 length 500 speed 60 direction bidirectional
edge E2 from J1 to B length 500 speed 60 direction bidirectional
section TA counted over E1
section TB counted over E2
"""

CIRCUIT_THEN_COUNTED = """
node A boundary
node J1 plain
node B boundary
edge E1 from A to J1 length 500 speed 60 direction bidirectional
edge E2 from J1 to B length 500 speed 60 direction bidirectional
section TA over E1
section TB counted over E2
"""

INTO_A_BUFFER = """
node A boundary
node J1 plain
node BAY buffer
edge E1 from A to J1 length 500 speed 60 direction bidirectional
edge E2 from J1 to BAY length 200 speed 15 direction bidirectional
section TA over E1
section TB counted over E2
"""

BOTH_LEGS_COUNTED = """
node A boundary
node P1 points
node B boundary
node C boundary
edge E1 from A to P1.toe length 500 speed 60 direction bidirectional
edge E2 from P1.normal to B length 500 speed 60 direction bidirectional
edge E3 from P1.reverse to C length 500 speed 40 direction bidirectional
section TA over E1
section TB counted over E2
section TC counted over E3
"""

TOE_COUNTED_TOO = BOTH_LEGS_COUNTED.replace("section TA over E1", "section TA counted over E1")

ONE_SECTION_TWO_EDGES = """
node A boundary
node J1 plain
node J2 plain
node B boundary
edge E1 from A to J1 length 300 speed 60 direction bidirectional
edge E2 from J1 to J2 length 300 speed 60 direction bidirectional
edge E3 from J2 to B length 300 speed 60 direction bidirectional
section TA counted over E1, E2
section TB counted over E3
"""

CROSSING_LAYOUT = """
node A boundary
node B boundary
node C boundary
node D boundary
node X crossing
edge S1 from A to X.a1 length 300 speed 40 direction bidirectional
edge S2 from X.a2 to B length 300 speed 40 direction bidirectional
edge S3 from C to X.b1 length 300 speed 40 direction bidirectional
edge S4 from X.b2 to D length 300 speed 40 direction bidirectional
section TA counted over S1
section TB counted over S2
section TC over S3
section TD over S4
"""

RUN_OF_THREE = """
node A boundary
node J1 plain
node J2 plain
node B boundary
edge E1 from A to J1 length 600 speed 60 direction down
edge E2 from J1 to J2 length 600 speed 60 direction down
edge E3 from J2 to B length 600 speed 60 direction down
section TA over E1
section TB {b} over E2
section TC {c} over E3
signal S1 on E1 at 600 facing forward direction down aspects 3
"""


def exported(text):
    """The interchange file for a plan, as a plain dictionary."""
    scheme = scheme_from_text(text)
    return json.loads(dumps(scheme, build_interlocking(scheme)))


def record_for(text, section):
    data = exported(text)
    return next(item for item in data["sections"] if item["name"] == section)


def heads_of(text, section):
    return record_for(text, section).get("heads")


def zone_of(text, section):
    return record_for(text, section).get("zone")


def zones_in(text):
    """Zone name to the sections in it, read off the section records."""
    grouped = {}
    for item in exported(text)["sections"]:
        if "zone" in item:
            grouped.setdefault(item["zone"], []).append(item["name"])
    return {name: sorted(members) for name, members in grouped.items()}


def locking_for(text):
    scheme = scheme_from_text(text)
    interlocking = build_interlocking(scheme)
    return build_locking(interlocking, build_matrix(interlocking))


# --- where the heads go ----------------------------------------------------


def test_a_counted_section_is_bounded_where_it_meets_other_track():
    assert heads_of(CIRCUIT_THEN_COUNTED, "TB") == ["B", "J1"]


def test_a_track_circuit_is_bounded_by_nothing_at_all():
    record = record_for(CIRCUIT_THEN_COUNTED, "TA")
    assert "heads" not in record
    assert "zone" not in record
    assert record_for(CIRCUIT_THEN_COUNTED, "TB")["heads"] == ["B", "J1"]


def test_a_leg_running_into_a_buffer_stop_wants_no_head():
    assert heads_of(INTO_A_BUFFER, "TB") == ["J1"]


def test_a_leg_running_to_the_edge_of_the_scheme_wants_one():
    assert "B" in heads_of(CIRCUIT_THEN_COUNTED, "TB")
    assert "A" in heads_of(PLAIN_PAIR, "TA")


def test_a_head_at_a_plain_join_is_named_for_the_node():
    assert heads_of(PLAIN_PAIR, "TA") == ["A", "J1"]
    assert heads_of(PLAIN_PAIR, "TB") == ["B", "J1"]


def test_every_leg_of_a_set_of_points_carries_its_own_head():
    assert heads_of(BOTH_LEGS_COUNTED, "TB") == ["B", "P1.normal"]
    assert heads_of(BOTH_LEGS_COUNTED, "TC") == ["C", "P1.reverse"]


def test_a_head_sits_on_the_section_own_leg_not_the_one_beyond():
    assert heads_of(TOE_COUNTED_TOO, "TA") == ["A", "P1.toe"]
    assert heads_of(TOE_COUNTED_TOO, "TB") == ["B", "P1.normal"]


def test_every_leg_of_a_crossing_carries_its_own_head():
    assert heads_of(CROSSING_LAYOUT, "TA") == ["A", "X.a1"]
    assert heads_of(CROSSING_LAYOUT, "TB") == ["B", "X.a2"]


def test_a_join_inside_one_counted_section_is_bounded_by_nothing():
    assert heads_of(ONE_SECTION_TWO_EDGES, "TA") == ["A", "J2"]


def test_a_section_over_several_edges_is_bounded_at_its_own_ends():
    assert heads_of(ONE_SECTION_TWO_EDGES, "TB") == ["B", "J2"]


# --- what resets with what -------------------------------------------------


def test_two_counted_bits_end_to_end_reset_as_one():
    assert zones_in(PLAIN_PAIR) == {"TA": ["TA", "TB"]}


def test_a_zone_takes_the_name_of_whichever_section_sorts_first():
    renamed = PLAIN_PAIR.replace("section TA counted", "section TZ counted")
    assert zone_of(renamed, "TZ") == "TB"
    assert zones_in(renamed) == {"TB": ["TB", "TZ"]}


def test_a_counted_section_on_its_own_is_a_zone_of_one():
    assert zones_in(CIRCUIT_THEN_COUNTED) == {"TB": ["TB"]}


def test_normal_and_reverse_beyond_a_circuited_toe_stay_separate():
    assert zones_in(BOTH_LEGS_COUNTED) == {"TB": ["TB"], "TC": ["TC"]}


def test_a_counted_toe_joins_both_of_its_legs_into_one_zone():
    assert zones_in(TOE_COUNTED_TOO) == {"TA": ["TA", "TB", "TC"]}


def test_the_straight_road_of_a_crossing_is_a_pair():
    assert zones_in(CROSSING_LAYOUT) == {"TA": ["TA", "TB"]}


def test_sections_running_together_over_several_edges_share_a_zone():
    assert zones_in(ONE_SECTION_TWO_EDGES) == {"TA": ["TA", "TB"]}


def test_a_scheme_with_no_counted_sections_has_no_zones_at_all():
    assert zones_in(PLAIN_PAIR.replace("counted ", "")) == {}
    assert zones_in(PLAIN_PAIR) != {}


# --- what it does to the way a route lets go -------------------------------


def test_a_route_all_inside_one_zone_releases_complete():
    entry = locking_for(RUN_OF_THREE.format(b="counted", c="counted")).entry("S1(M)")
    assert len(entry.subroutes) == 2
    assert entry.release is Release.COMPLETE
    assert not entry.is_sectional


def test_a_route_over_separate_detection_still_releases_sectionally():
    entry = locking_for(RUN_OF_THREE.format(b="counted", c="")).entry("S1(M)")
    assert len(entry.subroutes) == 2
    assert entry.release is Release.SECTIONAL
    both = locking_for(RUN_OF_THREE.format(b="counted", c="counted")).entry("S1(M)")
    assert both.release is Release.COMPLETE


def test_a_route_over_track_circuits_alone_is_left_as_it_was():
    entry = locking_for(RUN_OF_THREE.format(b="", c="")).entry("S1(M)")
    assert entry.release is Release.SECTIONAL
    counted = locking_for(RUN_OF_THREE.format(b="counted", c="counted")).entry("S1(M)")
    assert counted.release is not entry.release


def test_one_counted_section_on_its_own_does_not_make_a_route_complete():
    entry = locking_for(RUN_OF_THREE.format(b="", c="counted")).entry("S1(M)")
    assert entry.release is Release.SECTIONAL
    pair = locking_for(RUN_OF_THREE.format(b="counted", c="counted")).entry("S1(M)")
    assert pair.release is Release.COMPLETE


def test_the_track_a_route_holds_is_unchanged_either_way():
    both = locking_for(RUN_OF_THREE.format(b="counted", c="counted")).entry("S1(M)")
    mixed = locking_for(RUN_OF_THREE.format(b="counted", c="")).entry("S1(M)")
    assert [sub.section for sub in both.held_track()] == ["TB", "TC"]
    assert [sub.section for sub in mixed.held_track()] == ["TB", "TC"]
    assert both.release is not mixed.release


def test_the_whole_of_the_zone_still_comes_back():
    entry = locking_for(RUN_OF_THREE.format(b="counted", c="counted")).entry("S1(M)")
    assert sorted(sub.section for sub in entry.releases_in_order()) == ["TB", "TC"]
    assert entry.release is Release.COMPLETE


CHAIN_OF_THREE = """
node A boundary
node J1 plain
node J2 plain
node B boundary
edge E1 from A to J1 length 400 speed 60 direction bidirectional
edge E2 from J1 to J2 length 400 speed 60 direction bidirectional
edge E3 from J2 to B length 400 speed 60 direction bidirectional
section TA counted over E1
section TB counted over E2
section TC counted over E3
"""

BROKEN_CHAIN = CHAIN_OF_THREE.replace("section TB counted over E2", "section TB over E2")

ONE_WAY = """
node A boundary
node J1 plain
node B boundary
edge E1 from A to J1 length 500 speed 60 direction down
edge E2 from J1 to B length 500 speed 60 direction down
section TA counted over E1
section TB counted over E2
"""

SLIP_LAYOUT = """
node A boundary
node B boundary
node C boundary
node D boundary
node X slip double yes
edge S1 from A to X.a1 length 200 speed 20 direction bidirectional
edge S2 from X.a2 to B length 200 speed 20 direction bidirectional
edge S3 from C to X.b1 length 200 speed 20 direction bidirectional
edge S4 from X.b2 to D length 200 speed 20 direction bidirectional
section TA counted over S1
section TB over S2
section TC over S3
section TD over S4
"""

WITH_AN_OVERLAP = """
node A boundary
node J1 plain
node J2 plain
node J3 plain
node B boundary
edge E1 from A to J1 length 600 speed 60 direction down
edge E2 from J1 to J2 length 600 speed 60 direction down
edge E3 from J2 to J3 length 300 speed 60 direction down
edge E4 from J3 to B length 600 speed 60 direction down
section TA over E1
section TB {b} over E2
section TC {c} over E3
section TD {d} over E4
signal S1 on E1 at 600 facing forward direction down aspects 3
signal S3 on E3 at 300 facing forward direction down aspects 3
"""


def test_a_chain_of_counted_sections_is_all_one_zone():
    assert zones_in(CHAIN_OF_THREE) == {"TA": ["TA", "TB", "TC"]}


def test_a_track_circuit_in_the_middle_breaks_the_chain():
    assert zones_in(BROKEN_CHAIN) == {"TA": ["TA"], "TC": ["TC"]}


def test_the_broken_chain_is_still_bounded_at_the_break():
    assert heads_of(BROKEN_CHAIN, "TA") == ["A", "J1"]
    assert heads_of(BROKEN_CHAIN, "TC") == ["B", "J2"]


def test_track_worked_one_way_only_still_joins_its_neighbour():
    assert zones_in(ONE_WAY) == {"TA": ["TA", "TB"]}


def test_a_slip_gives_its_legs_their_own_heads():
    assert heads_of(SLIP_LAYOUT, "TA") == ["A", "X.a1"]


def test_a_slip_leg_beside_track_circuits_is_a_zone_of_one():
    assert zones_in(SLIP_LAYOUT) == {"TA": ["TA"]}


def test_kingsmoor_has_one_counted_section_bounded_at_its_points():
    plan = pathlib.Path("tests/data/kingsmoor.sbx").read_text(encoding="utf-8")
    assert heads_of(plan, "TU") == ["P105.reverse"]
    assert zone_of(plan, "TU") == "TU"


def test_a_circuited_overlap_keeps_the_route_sectional():
    mixed = WITH_AN_OVERLAP.format(b="counted", c="counted", d="")
    entry = locking_for(mixed).entry("S1(M)")
    assert entry.overlap_subroutes
    assert entry.release is Release.SECTIONAL
    report = build_locking_report(build_interlocking(scheme_from_text(mixed)))
    assert report.row("S1(M)").cell("zones") == "TB"


def test_a_route_and_its_overlap_in_one_zone_release_together():
    whole = WITH_AN_OVERLAP.format(b="counted", c="counted", d="counted")
    entry = locking_for(whole).entry("S1(M)")
    assert entry.release is Release.COMPLETE
    circuited = WITH_AN_OVERLAP.format(b="counted", c="counted", d="")
    assert locking_for(circuited).entry("S1(M)").release is Release.SECTIONAL


def test_the_overlap_counts_as_track_the_route_is_holding():
    whole = WITH_AN_OVERLAP.format(b="counted", c="counted", d="counted")
    entry = locking_for(whole).entry("S1(M)")
    held = [sub.section for sub in entry.held_track()]
    assert "TD" in held
    assert len(held) > len(entry.subroutes)
    assert entry.release is Release.COMPLETE


def test_a_zone_survives_the_sections_being_declared_the_other_way_round():
    swapped = """
node A boundary
node J1 plain
node B boundary
edge E1 from A to J1 length 500 speed 60 direction bidirectional
edge E2 from J1 to B length 500 speed 60 direction bidirectional
section TB counted over E2
section TA counted over E1
"""
    assert zones_in(swapped) == {"TA": ["TA", "TB"]}
    assert heads_of(swapped, "TA") == ["A", "J1"]
