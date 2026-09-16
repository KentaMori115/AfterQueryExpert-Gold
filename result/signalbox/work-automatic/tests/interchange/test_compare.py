import copy

import pytest

from signalbox.interchange.compare import Comparison, Difference, compare
from signalbox.interchange.model import as_dict
from signalbox.signalling.interlocking import build_interlocking


@pytest.fixture
def data(kingsmoor):
    return as_dict(kingsmoor, build_interlocking(kingsmoor))


def test_a_file_against_itself_is_identical(data):
    result = compare(data, data)
    assert result.same
    assert result.summary() == "identical"
    assert result.report() == "identical\n"


def test_a_removed_route_is_reported(data):
    after = copy.deepcopy(data)
    after["routes"] = [r for r in after["routes"] if r["name"] != "K7(M)"]
    result = compare(data, after)
    assert result.removed == ["K7(M)"]
    assert not result.same


def test_an_added_route_is_reported(data):
    after = copy.deepcopy(data)
    extra = copy.deepcopy(after["routes"][0])
    extra["name"] = "K9(M)"
    after["routes"].append(extra)
    result = compare(data, after)
    assert result.added == ["K9(M)"]


def test_a_changed_field_is_reported_with_both_values(data):
    after = copy.deepcopy(data)
    after["routes"][0]["release"] = "complete"
    result = compare(data, after)
    assert len(result.changed) == 1
    assert result.changed[0].field == "release"
    assert result.changed[0].before == "sectional"


def test_changes_to_track_holding_are_noticed(data):
    after = copy.deepcopy(data)
    after["routes"][0]["track"] = ["TB-AB"]
    result = compare(data, after)
    assert any(difference.field == "track" for difference in result.changed)


def test_a_change_to_the_layout_is_noticed(data):
    after = copy.deepcopy(data)
    after["track"] = after["track"][:-1]
    result = compare(data, after)
    assert any(difference.where == "scheme" for difference in result.changed)
    assert "entries" in str(result.changed[-1])


def test_routes_touched_gathers_every_name(data):
    after = copy.deepcopy(data)
    after["routes"][0]["release"] = "complete"
    after["routes"] = [r for r in after["routes"] if r["name"] != "K7(M)"]
    result = compare(data, after)
    assert "K7(M)" in result.routes_touched()
    assert data["routes"][0]["name"] in result.routes_touched()


def test_differences_print_readably():
    assert str(Difference("K1(M)", "release", "sectional", "complete")) == (
        "K1(M) release: sectional -> complete"
    )
    assert str(Difference("K1(M)", "track", ["TB-AB"], [])) == "K1(M) track: TB-AB -> -"
    assert str(Difference("K1(M)", "points", {"P1": "normal"}, None)) == (
        "K1(M) points: P1=normal -> -"
    )


def test_an_empty_comparison_is_the_same():
    assert Comparison().same


def test_the_report_lists_everything(data):
    after = copy.deepcopy(data)
    after["routes"] = [r for r in after["routes"] if r["name"] != "K7(M)"]
    report = compare(data, after).report()
    assert "removed K7(M)" in report
    assert report.strip().endswith("changed")


def test_a_comparison_can_be_written_as_json(data):
    import json

    after = copy.deepcopy(data)
    after["routes"] = [r for r in after["routes"] if r["name"] != "K7(M)"]
    found = json.loads(compare(data, after).json())
    assert found["removed"] == ["K7(M)"]
    assert found["same"] is False


def test_an_identical_comparison_says_so_in_json(data):
    import json

    found = json.loads(compare(data, data).json())
    assert found["same"] is True
    assert found["changed"] == []


def test_the_json_carries_the_summary(data):
    assert compare(data, data).as_dict()["summary"] == "identical"
