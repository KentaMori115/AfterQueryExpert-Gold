"""What a temporary speed restriction covers, and what a train may do on it.

The plan says where a slack starts and how long it is. Everything else about it
is worked out: which pieces of track that length reaches, what a train may do at
any one place on them, and what the fastest and slowest a train is held to over
a whole piece of track are, which are two different questions with two
different answers.
"""

from __future__ import annotations

import pytest

import signalbox
from signalbox.errors import (
    DuplicateNameError,
    LayoutError,
    ParseError,
    UnknownReferenceError,
)
from typer.testing import CliRunner

from signalbox.cli.main import app
from signalbox.layout.format import format_scheme
from signalbox.layout.loader import load_text
from signalbox.units import Distance

PLAIN = """
scheme demo {
    area "Demo"
    prefix D
}

node WD boundary
node J1 plain
node J2 plain
node ED boundary

edge D1 from WD to J1 length 1000 speed 60 direction down
edge D2 from J1 to J2 length 800 speed 60 direction down
edge D3 from J2 to ED length 900 speed 60 direction down

section TA over D1
section TB over D2
section TC over D3

signal K1 on D1 at 980 facing forward direction down aspects 4
signal K3 on D2 at 780 facing forward direction down aspects 4
"""

JUNCTION = """
scheme junction {
    area "Junction"
    prefix J
}

node WD boundary
node P101 points
node ED boundary
node BAY buffer

edge J1 from WD to P101.toe length 900 speed 45 direction down
edge J2 from P101.normal to ED length 700 speed 45 direction down
edge J3 from P101.reverse to BAY length 400 speed 15 direction down

section TA over J1
section TB over J2
section TC over J3

signal S1 on J1 at 880 facing forward direction down aspects 3
"""

DRAWN_BACK = """
scheme back {
    area "Back"
    prefix B
}

node WD boundary
node J1 plain
node J2 plain
node ED boundary

edge B1 from WD to J1 length 800 speed 60 direction bidirectional
edge B2 from J2 to J1 length 700 speed 45 direction bidirectional
edge B3 from J2 to ED length 600 speed 60 direction bidirectional

section TA over B1
section TB over B2
section TC over B3
"""

UNPOSTED = """
node A boundary
node B plain
node C boundary

edge U1 from A to B length 600
edge U2 from B to C length 600

section TA over U1
section TB over U2
"""


runner = CliRunner()


def plan(text, *extra):
    """A scheme built from one of the plans above plus the lines given."""
    return signalbox.parse(text + "".join(f"{line}\n" for line in extra))


def mph(speed):
    """A speed in miles an hour, whichever way it is held."""
    return speed.mph if hasattr(speed, "mph") else float(speed)


def test_a_restriction_lands_on_the_scheme():
    scheme = plan(PLAIN, "restriction TSR1 on D2 at 100 for 300 speed 20")
    assert mph(scheme.restriction("TSR1").speed) == pytest.approx(20.0)


def test_words_after_the_speed_are_kept():
    scheme = plan(PLAIN, 'restriction TSR1 on D2 at 100 for 300 speed 20 reason "renewals"')
    assert scheme.restriction("TSR1").attributes["reason"] == "renewals"


def test_a_restriction_holds_the_speed_down_where_it_covers():
    scheme = plan(PLAIN, "restriction TSR1 on D2 at 100 for 300 speed 20")
    assert mph(scheme.permissible_speed("D2", Distance(200.0))) == pytest.approx(20.0)


def test_track_the_restriction_does_not_reach_is_at_line_speed():
    scheme = plan(PLAIN, "restriction TSR1 on D2 at 100 for 300 speed 20")
    assert mph(scheme.permissible_speed("D2", Distance(700.0))) == pytest.approx(60.0)


def test_a_length_that_runs_past_the_edge_covers_the_next_one():
    scheme = plan(PLAIN, "restriction TSR1 on D2 at 600 for 600 speed 20")
    assert mph(scheme.permissible_speed("D3", Distance(300.0))) == pytest.approx(20.0)


def test_a_length_that_runs_past_the_edge_stops_where_it_should():
    scheme = plan(PLAIN, "restriction TSR1 on D2 at 600 for 600 speed 20")
    assert mph(scheme.permissible_speed("D3", Distance(500.0))) == pytest.approx(60.0)


def test_an_extent_runs_out_with_the_track_rather_than_failing():
    scheme = plan(PLAIN, "restriction TSR1 on D3 at 500 for 5000 speed 20")
    assert mph(scheme.permissible_speed("D3", Distance(880.0))) == pytest.approx(20.0)


def test_an_extent_follows_the_road_the_points_lie_for():
    scheme = plan(JUNCTION, "restriction TSR1 on J1 at 700 for 400 speed 10")
    assert mph(scheme.permissible_speed("J2", Distance(100.0))) == pytest.approx(10.0)


def test_an_extent_does_not_take_the_road_the_points_lie_against():
    scheme = plan(JUNCTION, "restriction TSR1 on J1 at 700 for 400 speed 10")
    assert mph(scheme.permissible_speed("J3", Distance(100.0))) == pytest.approx(15.0)


def test_the_slower_of_two_restrictions_governs():
    scheme = plan(
        PLAIN,
        "restriction TSR1 on D2 at 100 for 500 speed 30",
        "restriction TSR2 on D2 at 300 for 200 speed 15",
    )
    assert mph(scheme.permissible_speed("D2", Distance(400.0))) == pytest.approx(15.0)


def test_the_faster_of_two_restrictions_still_holds_where_it_is_alone():
    scheme = plan(
        PLAIN,
        "restriction TSR1 on D2 at 100 for 500 speed 30",
        "restriction TSR2 on D2 at 300 for 200 speed 15",
    )
    assert mph(scheme.permissible_speed("D2", Distance(200.0))) == pytest.approx(30.0)


def test_track_with_no_line_speed_is_worth_what_the_restriction_says():
    scheme = plan(UNPOSTED, "restriction TSR1 on U1 at 100 for 200 speed 25")
    assert mph(scheme.permissible_speed("U1", Distance(200.0))) == pytest.approx(25.0)


def test_track_with_no_line_speed_and_no_restriction_is_worth_nothing_stated():
    scheme = plan(UNPOSTED, "restriction TSR1 on U1 at 100 for 200 speed 25")
    assert scheme.permissible_speed("U2", Distance(200.0)) is None


def test_a_restriction_is_listed_against_the_edge_it_starts_on():
    scheme = plan(PLAIN, "restriction TSR1 on D2 at 600 for 600 speed 20")
    assert [r.name for r in scheme.restrictions_on("D2")] == ["TSR1"]


def test_a_restriction_is_listed_against_the_edge_it_runs_onto():
    scheme = plan(PLAIN, "restriction TSR1 on D2 at 600 for 600 speed 20")
    assert [r.name for r in scheme.restrictions_on("D3")] == ["TSR1"]


def test_an_edge_nothing_covers_lists_nothing():
    scheme = plan(PLAIN, "restriction TSR1 on D2 at 600 for 600 speed 20")
    assert [r.name for r in scheme.restrictions_on("D1")] == []


def test_a_restriction_on_track_that_is_not_there_is_refused():
    with pytest.raises(UnknownReferenceError):
        plan(PLAIN, "restriction TSR1 on D9 at 100 for 300 speed 20")


def refused_after_reading(line):
    """The plan reads, and then the layout is refused for what it says.

    A signal off the end of its edge is refused this way rather than by the
    tokeniser, and a restriction is the same kind of mistake: the writing is
    fine and the railway it describes is not.
    """
    with pytest.raises(LayoutError) as caught:
        plan(PLAIN, line)
    assert not isinstance(caught.value, ParseError)


def test_a_restriction_starting_off_the_end_of_its_edge_is_refused():
    refused_after_reading("restriction TSR1 on D2 at 900 for 100 speed 20")


def test_a_restriction_covering_no_track_is_refused():
    refused_after_reading("restriction TSR1 on D2 at 100 for 0 speed 20")


def test_a_restriction_at_no_speed_is_refused():
    refused_after_reading("restriction TSR1 on D2 at 100 for 300 speed 0")


def test_a_restriction_taking_a_name_already_used_is_refused():
    with pytest.raises(DuplicateNameError):
        plan(PLAIN, "restriction TA on D2 at 100 for 300 speed 20")


def test_the_formatter_writes_a_restriction_back():
    text = PLAIN + 'restriction TSR1 on D2 at 100 for 300 speed 20 reason "renewals"\n'
    written = format_scheme(load_text(text))
    assert "restriction TSR1" in written


def test_the_formatting_command_writes_a_restriction_back(tmp_path):
    path = tmp_path / "plan.sbx"
    path.write_text(PLAIN + "restriction TSR1 on D2 at 100 for 300 speed 20\n", encoding="utf-8")
    result = runner.invoke(app, ["fmt", str(path)])
    assert result.exit_code == 0
    assert "restriction TSR1" in path.read_text(encoding="utf-8")


def test_a_formatted_plan_still_says_the_same_thing():
    text = PLAIN + 'restriction TSR1 on D2 at 100 for 300 speed 20 reason "renewals"\n'
    again = signalbox.parse(format_scheme(load_text(text)))
    assert mph(again.permissible_speed("D2", Distance(200.0))) == pytest.approx(20.0)


def test_formatting_keeps_the_words_after_the_speed():
    text = PLAIN + 'restriction TSR1 on D2 at 100 for 300 speed 20 reason "renewals"\n'
    again = signalbox.parse(format_scheme(load_text(text)))
    assert again.restriction("TSR1").attributes["reason"] == "renewals"


def test_formatting_a_restriction_is_idempotent():
    text = PLAIN + "restriction TSR1 on D2 at 100 for 300 speed 20\n"
    once = format_scheme(load_text(text))
    twice = format_scheme(load_text(once))
    assert once == twice


def split_over_two_files(tmp_path):
    """A plan whose slack is declared in the file the other one includes.

    The restriction goes in the included file rather than the including one,
    since that is the direction a plan is actually written in: an area file
    with the track and what is on it, and a scheme file that pulls it in.
    """
    (tmp_path / "area.sbx").write_text(
        PLAIN + 'restriction TSR1 on D2 at 100 for 300 speed 20 reason "renewals"\n',
        encoding="utf-8",
    )
    plan_file = tmp_path / "scheme.sbx"
    plan_file.write_text(
        'scheme demo {\n    area "Demo"\n    prefix D\n}\n\ninclude "area.sbx"\n',
        encoding="utf-8",
    )
    return signalbox.load(plan_file)


def test_a_restriction_can_be_split_into_another_file(tmp_path):
    scheme = split_over_two_files(tmp_path)
    assert mph(scheme.permissible_speed("D2", Distance(200.0))) == pytest.approx(20.0)


def test_a_restriction_merged_from_another_file_is_reachable(tmp_path):
    scheme = split_over_two_files(tmp_path)
    assert [r.name for r in scheme.restrictions_on("D2")] == ["TSR1"]


def test_a_restriction_merged_from_another_file_keeps_its_words(tmp_path):
    scheme = split_over_two_files(tmp_path)
    assert scheme.restriction("TSR1").attributes["reason"] == "renewals"


def test_the_fastest_over_a_piece_of_track_ignores_a_slack_over_part_of_it():
    scheme = plan(PLAIN, "restriction TSR1 on D2 at 100 for 300 speed 20")
    assert mph(scheme.fastest_on("D2")) == pytest.approx(60.0)


def test_the_fastest_over_a_piece_of_track_drops_when_all_of_it_is_covered():
    scheme = plan(PLAIN, "restriction TSR1 on D2 at 0 for 800 speed 20")
    assert mph(scheme.fastest_on("D2")) == pytest.approx(20.0)


def test_the_slowest_over_a_piece_of_track_takes_a_slack_over_part_of_it():
    scheme = plan(PLAIN, "restriction TSR1 on D2 at 100 for 300 speed 20")
    assert mph(scheme.slowest_on("D2")) == pytest.approx(20.0)


def test_the_slowest_over_untouched_track_is_line_speed():
    scheme = plan(PLAIN, "restriction TSR1 on D2 at 100 for 300 speed 20")
    assert mph(scheme.slowest_on("D1")) == pytest.approx(60.0)


def test_the_first_metre_of_a_restriction_is_restricted():
    scheme = plan(PLAIN, "restriction TSR1 on D2 at 100 for 300 speed 20")
    assert mph(scheme.permissible_speed("D2", Distance(100.0))) == pytest.approx(20.0)


def test_the_far_end_of_a_restriction_is_still_restricted():
    # A metre inside the far end, so that reading the length as running up to
    # its last metre or up to but not including it makes no difference here.
    scheme = plan(PLAIN, "restriction TSR1 on D2 at 100 for 300 speed 20")
    assert mph(scheme.permissible_speed("D2", Distance(399.0))) == pytest.approx(20.0)


def test_a_restriction_faster_than_the_line_leaves_the_line_where_it_was():
    scheme = plan(JUNCTION, "restriction TSR1 on J3 at 0 for 400 speed 40")
    assert mph(scheme.permissible_speed("J3", Distance(200.0))) == pytest.approx(15.0)


def test_an_extent_covers_a_piece_of_track_drawn_the_other_way_round():
    scheme = plan(DRAWN_BACK, "restriction TSR1 on B1 at 600 for 500 speed 15")
    assert mph(scheme.permissible_speed("B2", Distance(500.0))) == pytest.approx(15.0)


def test_an_extent_that_runs_into_a_buffer_stops_there():
    scheme = plan(JUNCTION, "restriction TSR1 on J1 at 800 for 5000 speed 10")
    assert mph(scheme.permissible_speed("J2", Distance(600.0))) == pytest.approx(10.0)


def test_an_extent_over_a_whole_piece_of_track_carries_on_to_the_next():
    scheme = plan(PLAIN, "restriction TSR1 on D1 at 500 for 1500 speed 25")
    assert mph(scheme.fastest_on("D2")) == pytest.approx(25.0)


def test_two_restrictions_on_one_piece_of_track_are_both_listed():
    scheme = plan(
        PLAIN,
        "restriction TSR1 on D2 at 100 for 200 speed 30",
        "restriction TSR2 on D2 at 400 for 200 speed 15",
    )
    assert sorted(r.name for r in scheme.restrictions_on("D2")) == ["TSR1", "TSR2"]


def test_a_restriction_with_nothing_written_after_the_speed_carries_nothing():
    scheme = plan(PLAIN, "restriction TSR1 on D2 at 100 for 300 speed 20")
    assert scheme.restriction("TSR1").attributes == {}
