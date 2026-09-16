"""Signals a plan hands to the trains, read off the plan rather than worked.

The flag is one word in the scheme plan and it changes what the whole scheme
means, so the first thing worth having is the check: a plan that says a signal
looks after itself, on a layout that will not have it, has to be told so before
anybody builds it. These read the finished scheme and the command line, and
leave the machine to the other file.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from typer.testing import CliRunner

from signalbox.cli.main import app
from signalbox.topology.scheme import scheme_from_text
from signalbox.verify import checks as _checks  # noqa: F401  (registers the rules)
from signalbox.verify.report import Severity
from signalbox.verify.rules import Context, run

runner = CliRunner()

#: Plain line, three signals, the middle one left to the trains. Nothing on it
#: needs moving and nothing else reads over the same track, so the flag holds.
PLAIN = """
scheme longmoor { area "Longmoor" prefix S }
standards {
    flank 1200
}
node A boundary
node J1 plain
node J2 plain
node J3 plain
node B boundary
edge E1 from A to J1 length 1400 speed 60 gradient level direction down
edge E2 from J1 to J2 length 1400 speed 60 gradient level direction down
edge E3 from J2 to J3 length 1400 speed 60 gradient level direction down
edge E4 from J3 to B length 1400 speed 60 gradient level direction down
section TA over E1
section TB over E2
section TC over E3
section TD over E4
signal S1 on E1 at 1400 facing forward direction down aspects 4 sighting 300
signal S3 on E2 at 1400 facing forward direction down aspects 4 sighting 300 automatic yes
signal S5 on E3 at 1400 facing forward direction down aspects 4 sighting 300
"""

#: The same plan with the flag taken off, which is what the findings are read
#: against: anything reported on both is about the layout, not about the flag.
WORKED = PLAIN.replace(" automatic yes", "")

#: Facing points under the automatic signal, so it reads two ways and nothing
#: on the ground decides which of them a train is given.
CHOICE = """
scheme fork { area "Fork" prefix S }
node A boundary
node P1 points
node B boundary
node C boundary
edge E1 from A to P1.toe length 1000 speed 60 direction down
edge E2 from P1.normal to B length 1000 speed 60 direction down
edge E3 from P1.reverse to C length 1000 speed 40 direction down
section TA over E1
section TB over E2
section TC over E3
signal S1 on E1 at 1000 facing forward direction down aspects 3 automatic yes
"""

#: A warning arrangement on the same plain line: two routes read from the
#: signal, both over the same track, and nothing on the ground says which of
#: them a train is given.
WARNING_ROUTE = PLAIN.replace(
    "sighting 300 automatic yes", "sighting 300 automatic yes warning yes"
)

#: Nothing on the route itself to move, and a set of points inside the overlap
#: beyond the signal it reads to.
OVERLAP = """
scheme ovl { area "Overlap" prefix S }
standards {
    flank 1200
    overlap 400
}
node A boundary
node J1 plain
node J2 plain
node P1 points
node B boundary
node C boundary
edge E1 from A to J1 length 1400 speed 60 gradient level direction down
edge E2 from J1 to J2 length 1400 speed 60 gradient level direction down
edge E3 from J2 to P1.toe length 300 speed 60 gradient level direction down
edge E4 from P1.normal to B length 900 speed 60 gradient level direction down
edge E5 from P1.reverse to C length 900 speed 40 gradient level direction down
section TA over E1
section TB over E2
section TC over E3
section TD over E4
section TE over E5
signal S1 on E1 at 1400 facing forward direction down aspects 4 sighting 300
signal S3 on E2 at 1400 facing forward direction down aspects 4 sighting 300 automatic yes
signal S5 on E3 at 300 facing forward direction down aspects 4 sighting 300
"""

#: Trailing points instead, so there is only one route, and it still calls the
#: blades. Nobody is there to call them.
TRAILING = """
scheme merge { area "Merge" prefix S }
node A boundary
node C boundary
node P1 points
node B boundary
edge E1 from A to P1.normal length 1000 speed 60 direction down
edge E4 from C to P1.reverse length 1000 speed 60 direction down
edge E2 from P1.toe to B length 1000 speed 60 direction down
section TA over E1
section TD over E4
section TB over E2
signal S1 on E1 at 1000 facing forward direction down aspects 3 automatic yes
"""

#: An automatic signal facing the way the track is not worked, so no route
#: reads from it at all.
NOTHING = """
scheme stub { area "Stub" prefix S }
node A boundary
node J1 plain
node B boundary
edge E1 from A to J1 length 900 speed 60 direction down
edge E2 from J1 to B length 900 speed 60 direction bidirectional
section TA over E1
section TB over E2
signal S1 on E1 at 900 facing forward direction down aspects 3
signal S3 on E2 at 0 facing backward direction up aspects 3 automatic yes
"""


#: The automatic route on plain line, with an up move signalled over the same
#: track. Both cannot stand, and the one a signaller asks for is the one that
#: gives way.
OPPOSED = """
scheme bothways { area "Bothways" prefix S }
standards {
    flank 1200
}
node A boundary
node J1 plain
node J2 plain
node J3 plain
node B boundary
edge E1 from A to J1 length 1400 speed 60 gradient level direction bidirectional
edge E2 from J1 to J2 length 1400 speed 60 gradient level direction bidirectional
edge E3 from J2 to J3 length 1400 speed 60 gradient level direction bidirectional
edge E4 from J3 to B length 1400 speed 60 gradient level direction down
section TA over E1
section TB over E2
section TC over E3
section TD over E4
signal S1 on E1 at 1400 facing forward direction down aspects 4 sighting 300
signal S3 on E2 at 1400 facing forward direction down aspects 4 sighting 300 automatic yes
signal S5 on E3 at 1400 facing forward direction down aspects 4 sighting 300
signal S8 on E3 at 1400 facing backward direction up aspects 4 sighting 300
"""


def flat(text: str) -> str:
    """Output with every space taken out.

    A table folds a long cell over two lines to fit the terminal it is given,
    which puts a newline inside a name. What is printed is the question here,
    not where it wrapped.
    """
    return "".join(text.split())


def report_for(text: str):
    scheme = scheme_from_text(text)
    return run(Context.build(scheme))


def about(text: str, rule: str):
    return report_for(text).by_rule(rule)


@pytest.fixture
def plan(tmp_path: Path):
    def write(text: str, name: str = "plan.sbx") -> Path:
        path = tmp_path / name
        path.write_text(text, encoding="utf-8")
        return path

    return write


def test_a_signal_that_can_be_left_to_the_trains_is_not_reported():
    scheme = scheme_from_text(PLAIN)
    assert len(run(Context.build(scheme), only=["auto-working"])) == 0


def test_a_plan_that_hands_over_a_plain_line_has_nothing_wrong_with_it():
    report = report_for(PLAIN)
    assert "auto-working" in report.ran
    assert report.errors() == []


def test_nothing_at_all_is_said_about_the_automatic_signal():
    report = report_for(PLAIN)
    assert "auto-working" in report.ran
    assert report.about("S3") == []


def test_the_findings_are_the_same_whether_the_flag_is_there_or_not():
    with_flag = {finding.key for finding in report_for(PLAIN)}
    without = {finding.key for finding in report_for(WORKED)}
    assert "auto-working" in report_for(PLAIN).ran
    assert with_flag == without


def test_a_signal_reading_two_ways_cannot_be_left_to_the_trains():
    found = about(CHOICE, "auto-working")
    assert len(found) == 1
    assert found[0].subject == "S1"


def test_two_routes_over_the_same_track_are_a_choice_as_well():
    found = about(WARNING_ROUTE, "auto-working")
    assert len(found) == 1
    assert found[0].subject == "S3"


def test_points_in_the_overlap_count_too():
    found = about(OVERLAP, "auto-working")
    assert len(found) == 1
    assert found[0].subject == "S3"


def test_reading_two_ways_is_an_error():
    assert about(CHOICE, "auto-working")[0].severity is Severity.ERROR


def test_a_signal_whose_route_calls_points_cannot_be_left_to_the_trains():
    found = about(TRAILING, "auto-working")
    assert len(found) == 1
    assert found[0].subject == "S1"


def test_calling_points_is_an_error_too():
    assert about(TRAILING, "auto-working")[0].severity is Severity.ERROR


def test_a_signal_with_no_route_cannot_be_left_to_the_trains():
    found = about(NOTHING, "auto-working")
    assert [finding.subject for finding in found] == ["S3"]


def test_the_flag_is_what_makes_the_difference():
    for text in (CHOICE, TRAILING, NOTHING, WARNING_ROUTE, OVERLAP):
        assert len(about(text, "auto-working")) == 1
        assert about(text.replace(" automatic yes", ""), "auto-working") == []


def test_the_rule_can_be_asked_for_by_name():
    scheme = scheme_from_text(CHOICE)
    report = run(Context.build(scheme), only=["auto-working"])
    assert len(report) == 1


def test_the_rule_stops_a_scheme_being_approved():
    assert "auto-working" in {finding.rule for finding in report_for(CHOICE).errors()}
    assert not report_for(CHOICE).ok


def test_the_signal_is_what_the_finding_is_about():
    for text in (CHOICE, TRAILING, NOTHING, WARNING_ROUTE, OVERLAP):
        found = about(text, "auto-working")[0]
        assert found.subject in scheme_from_text(text).signals


def test_only_the_signal_that_cannot_be_left_to_the_trains_is_reported():
    both = TRAILING.replace(
        "signal S1 on E1 at 1000 facing forward direction down aspects 3 automatic yes",
        "signal S1 on E1 at 1000 facing forward direction down aspects 3 automatic yes\n"
        "signal S7 on E2 at 1000 facing forward direction down aspects 3 automatic yes",
    )
    found = about(both, "auto-working")
    assert [finding.subject for finding in found] == ["S1"]


def test_the_command_names_the_signal_and_the_route_it_works(plan):
    result = runner.invoke(app, ["automatic", str(plan(PLAIN))])
    assert result.exit_code == 0
    assert "S3" in flat(result.stdout)
    assert "S3(M)" in flat(result.stdout)


def test_the_command_names_the_routes_a_signal_had_a_choice_of(plan):
    result = runner.invoke(app, ["automatic", str(plan(CHOICE))])
    assert result.exit_code == 0
    shown = flat(result.stdout)
    assert "S1(MA)" in shown
    assert "S1(MB)" in shown


def test_the_command_names_the_points_that_would_want_moving(plan):
    result = runner.invoke(app, ["automatic", str(plan(TRAILING))])
    assert result.exit_code == 0
    assert "P1" in flat(result.stdout)


def test_the_command_names_the_points_in_an_overlap_too(plan):
    result = runner.invoke(app, ["automatic", str(plan(OVERLAP))])
    assert result.exit_code == 0
    assert "P1" in flat(result.stdout)


def test_a_working_signal_needs_no_reason_given(plan):
    result = runner.invoke(app, ["automatic", str(plan(PLAIN))])
    assert result.exit_code == 0
    assert "S1(M" not in flat(result.stdout)


def test_the_command_is_quiet_where_nothing_is_automatic(plan):
    result = runner.invoke(app, ["automatic", str(plan(WORKED))])
    assert result.exit_code == 0
    assert "S3(M)" not in flat(result.stdout)


def test_the_command_can_be_asked_for_the_faults_alone(plan):
    result = runner.invoke(app, ["automatic", str(plan(CHOICE)), "--faults"])
    assert result.exit_code == 0
    assert "S1" in flat(result.stdout)


def test_a_working_signal_is_not_a_fault(plan):
    result = runner.invoke(app, ["automatic", str(plan(PLAIN)), "--faults"])
    assert result.exit_code == 0
    assert "S3(M)" not in flat(result.stdout)



def test_the_command_reads_every_example(plan):
    for text in (PLAIN, CHOICE, TRAILING, NOTHING, WARNING_ROUTE, OVERLAP):
        result = runner.invoke(app, ["automatic", str(plan(text))])
        assert result.exit_code == 0, result.stdout


def test_the_command_names_the_move_a_signaller_will_never_be_offered(plan):
    result = runner.invoke(app, ["automatic", str(plan(OPPOSED)), "--locks"])
    assert result.exit_code == 0
    assert "S8(M)" in flat(result.stdout)


def test_a_move_nothing_stands_against_is_not_listed(plan):
    result = runner.invoke(app, ["automatic", str(plan(PLAIN)), "--locks"])
    assert result.exit_code == 0
    assert "S1(M)" not in flat(result.stdout)
