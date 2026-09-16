import copy

import pytest

from signalbox.interchange.model import as_dict
from signalbox.interchange.schema import RECORDS, Field, describe, problems, valid
from signalbox.signalling.interlocking import build_interlocking


@pytest.fixture
def data(kingsmoor):
    return as_dict(kingsmoor, build_interlocking(kingsmoor))


def test_a_file_this_package_wrote_is_valid(data):
    assert valid(data), list(problems(data))


def test_every_list_in_the_file_is_described():
    assert set(RECORDS) == {
        "track",
        "sections",
        "signals",
        "crossings",
        "traps",
        "routes",
    }


def test_a_missing_list_is_reported(data):
    del data["routes"]
    assert "no routes in the file" in list(problems(data))


def test_a_list_that_is_not_a_list_is_reported(data):
    data["routes"] = {"K1(M)": {}}
    assert any("expected a list" in problem for problem in problems(data))


def test_a_record_that_is_not_an_object_is_reported(data):
    data["routes"] = ["K1(M)"]
    assert any("expected an object" in problem for problem in problems(data))


def test_a_missing_field_is_reported(data):
    del data["routes"][0]["release"]
    assert any("has no release" in problem for problem in problems(data))


def test_a_field_of_the_wrong_kind_is_reported(data):
    data["routes"][0]["length"] = "quite long"
    assert any("expected" in problem for problem in problems(data))


def test_an_optional_field_may_be_missing(data):
    for edge in data["track"]:
        edge.pop("speed", None)
    assert valid(data)


def test_an_optional_field_may_be_null(data):
    data["signals"][0]["direction"] = None
    assert valid(data)


def test_a_required_field_may_not_be_null(data):
    data["routes"][0]["release"] = None
    assert not valid(data)


def test_the_schema_can_be_written_out():
    text = describe()
    assert "routes:" in text
    assert "release: str" in text
    assert "speed: " in text and "optional" in text


def test_fields_print_what_they_want():
    assert str(Field("name", str)) == "name: str"
    assert str(Field("speed", float, required=False)) == "speed: float, optional"
    assert "one of several" in str(Field("length", (int, float)))


def test_a_deep_copy_is_still_valid(data):
    assert valid(copy.deepcopy(data))
