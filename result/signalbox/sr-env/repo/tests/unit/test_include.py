import pytest

from signalbox.errors import LayoutError, ParseError
from signalbox.layout.ast import SchemeDecl
from signalbox.layout.loader import load_path, load_text
from signalbox.layout.parser import parse
from signalbox.topology.scheme import build_scheme

SPLIT = "tests/data/split/scheme.sbx"


def test_includes_are_recorded_by_the_parser():
    scheme = parse('include "area.sbx"\n')
    assert scheme.includes == ["area.sbx"]


def test_an_unquoted_name_works_too():
    assert parse("include area\n").includes == ["area"]


def test_an_include_with_no_name_is_refused():
    with pytest.raises(ParseError, match="include wants a file name"):
        parse("include\n")


def test_load_text_does_not_follow_includes():
    scheme = load_text('include "nowhere.sbx"\n')
    assert scheme.includes == ["nowhere.sbx"]
    assert scheme.nodes == []


def test_a_split_scheme_loads_as_one():
    scheme = load_path(SPLIT)
    assert [node.name for node in scheme.nodes] == ["W", "E", "J"]
    assert len(scheme.edges) == 2
    assert len(scheme.signals) == 1


def test_the_including_file_keeps_its_own_header():
    scheme = load_path(SPLIT)
    assert scheme.name == "netherby"
    assert scheme.area == "Netherby"


def test_the_merged_plan_builds():
    scheme = build_scheme(load_path(SPLIT))
    assert scheme.describe() == "Netherby: 3 nodes, 2 edges, 2 sections, 1 signals"


def test_a_missing_include_is_reported(tmp_path):
    plan = tmp_path / "top.sbx"
    plan.write_text('include "nowhere.sbx"\n')
    with pytest.raises(LayoutError, match="cannot read"):
        load_path(plan)


def test_an_include_loop_is_caught(tmp_path):
    one = tmp_path / "one.sbx"
    two = tmp_path / "two.sbx"
    one.write_text('include "two.sbx"\n')
    two.write_text('include "one.sbx"\n')
    with pytest.raises(LayoutError, match="include loop"):
        load_path(one)


def test_a_file_including_itself_is_caught(tmp_path):
    plan = tmp_path / "self.sbx"
    plan.write_text('include "self.sbx"\n')
    with pytest.raises(LayoutError, match="include loop"):
        load_path(plan)


def test_merging_takes_the_header_only_when_there_is_none():
    first = SchemeDecl(name="a", area=None, prefix=None)
    second = SchemeDecl(name="b", area="Second", prefix="S")
    first.merge(second)
    assert first.name == "a"
    assert first.area == "Second"
    assert first.prefix == "S"


def test_merging_does_not_overwrite_a_header_that_is_there():
    first = SchemeDecl(name="a", area="First", prefix="F")
    first.merge(SchemeDecl(name="b", area="Second", prefix="S"))
    assert first.area == "First"
    assert first.prefix == "F"


def test_validation_happens_after_merging(tmp_path):
    # The signal is in one file and the edge it stands on is in the other.
    (tmp_path / "track.sbx").write_text(
        "node A boundary\nnode B boundary\nedge E1 from A to B length 400 direction down\n"
    )
    top = tmp_path / "top.sbx"
    top.write_text(
        'include "track.sbx"\nsignal S1 on E1 at 200 facing forward direction down\n'
    )
    assert len(load_path(top).signals) == 1
