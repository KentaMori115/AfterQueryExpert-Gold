"""The parts of a scheme the interchange file used to leave out."""

from __future__ import annotations

import pytest

from signalbox.interchange.model import SCHEMA_VERSION, as_dict
from signalbox.interchange.schema import RECORDS, valid
from signalbox.layout.loader import load_path
from signalbox.signalling.interlocking import build_interlocking
from signalbox.topology.scheme import build_scheme


def data_for(path):
    scheme = build_scheme(load_path(path))
    return scheme, as_dict(scheme, build_interlocking(scheme))


@pytest.fixture
def kingsmoor_data(kingsmoor):
    return as_dict(kingsmoor, build_interlocking(kingsmoor))


def test_the_schema_version_has_moved_on():
    assert SCHEMA_VERSION == 2


def test_the_design_figures_come_through(kingsmoor_data):
    figures = kingsmoor_data["standards"]
    assert figures["overlap"] == 183.0
    assert figures["braking"] == 0.45
    assert set(figures) == {
        "overlap",
        "reduced_overlap",
        "braking",
        "reaction",
        "flank",
        "approach",
        "throw",
        "route_limit",
    }


def test_a_scheme_with_its_own_figures_says_so():
    _scheme, data = data_for("examples/ferrybridge-quay.sbx")
    assert data["standards"]["overlap"] == 46.0


def test_crossings_come_through():
    _scheme, data = data_for("tests/data/marlow-crossing.sbx")
    names = [crossing["name"] for crossing in data["crossings"]]
    assert names == ["LC21", "LC23", "LC25"]
    assert data["crossings"][0]["requirement"] == "LC21 barriers down"


def test_traps_come_through():
    _scheme, data = data_for("examples/ferrybridge-quay.sbx")
    assert [trap["name"] for trap in data["traps"]] == ["TP31"]
    assert data["traps"][0]["facing"] == "reverse"


def test_a_scheme_with_neither_writes_empty_lists(kingsmoor_data):
    assert kingsmoor_data["crossings"] == []
    assert kingsmoor_data["traps"] == []


def test_mileage_comes_through_where_the_scheme_has_one():
    _scheme, data = data_for("tests/data/netherby-mileage.sbx")
    first = next(edge for edge in data["track"] if edge["name"] == "NE1")
    assert first["mileage"] is not None


def test_mileage_is_null_where_it_has_none(kingsmoor_data):
    assert all(edge["mileage"] is None for edge in kingsmoor_data["track"])


def test_the_new_records_are_in_the_schema():
    assert "crossings" in RECORDS
    assert "traps" in RECORDS


def test_the_file_is_still_valid_against_the_schema(kingsmoor_data):
    assert valid(kingsmoor_data)


def test_every_example_is_valid_against_the_schema():
    from pathlib import Path

    for path in sorted(Path("examples").glob("*.sbx")):
        _scheme, data = data_for(path)
        assert valid(data), path.name


def test_the_file_says_what_wrote_it(kingsmoor_data):
    from signalbox import __version__

    assert kingsmoor_data["written_by"] == f"signalbox {__version__}"


def test_an_older_file_says_it_came_from_before_that(kingsmoor_data):
    import copy

    from signalbox.interchange.migrate import migrate

    old = copy.deepcopy(kingsmoor_data)
    old["schema"] = 1
    for key in ("written_by", "standards", "crossings", "traps"):
        old.pop(key, None)
    assert migrate(old)["written_by"] == "signalbox before 0.3.0"


def test_what_wrote_it_does_not_affect_a_comparison(kingsmoor_data):
    import copy

    from signalbox.interchange.compare import compare

    other = copy.deepcopy(kingsmoor_data)
    other["written_by"] = "somebody else"
    assert compare(kingsmoor_data, other).same
