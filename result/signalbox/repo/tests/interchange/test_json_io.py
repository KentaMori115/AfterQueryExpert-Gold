import json

import pytest

from signalbox.interchange.json_io import (
    InterchangeError,
    dumps,
    fingerprint,
    loads,
    read,
    route_names,
    to_text,
    write,
)
from signalbox.interchange.model import SCHEMA_VERSION, as_dict
from signalbox.signalling.interlocking import build_interlocking


@pytest.fixture
def text(kingsmoor):
    return dumps(kingsmoor, build_interlocking(kingsmoor))


def test_the_file_is_sorted_json_with_a_trailing_newline(text):
    assert text.endswith("}\n")
    data = json.loads(text)
    assert list(data) == sorted(data)


def test_what_goes_out_comes_back(text, kingsmoor):
    assert loads(text) == as_dict(kingsmoor, build_interlocking(kingsmoor))


def test_the_same_scheme_gives_the_same_bytes(kingsmoor):
    assert dumps(kingsmoor, build_interlocking(kingsmoor)) == dumps(
        kingsmoor, build_interlocking(kingsmoor)
    )


def test_rubbish_is_refused():
    with pytest.raises(InterchangeError, match="not valid JSON"):
        loads("{definitely not json")


def test_a_list_at_the_top_is_refused():
    with pytest.raises(InterchangeError, match="object at the top level"):
        loads("[]")


def test_a_file_with_no_schema_is_refused():
    with pytest.raises(InterchangeError, match="not an interchange file"):
        loads('{"routes": []}')


def test_a_file_from_the_future_is_refused():
    with pytest.raises(InterchangeError, match="later version"):
        loads(json.dumps({"schema": SCHEMA_VERSION + 5}))


def test_a_file_missing_a_section_is_refused():
    with pytest.raises(InterchangeError, match="no routes in the file"):
        loads(
            json.dumps(
                {
                    "schema": SCHEMA_VERSION,
                    "scheme": {},
                    "track": [],
                    "sections": [],
                    "signals": [],
                    "crossings": [],
                    "traps": [],
                }
            )
        )


def test_writing_and_reading_a_file(tmp_path, kingsmoor):
    path = tmp_path / "kingsmoor.sbj"
    written = write(path, kingsmoor, build_interlocking(kingsmoor))
    assert written > 0
    assert read(path)["scheme"]["name"] == "kingsmoor"


def test_writing_somewhere_impossible_is_reported(tmp_path, kingsmoor):
    with pytest.raises(InterchangeError, match="cannot write"):
        write(tmp_path / "no" / "such" / "x.sbj", kingsmoor, build_interlocking(kingsmoor))


def test_reading_something_that_is_not_there_is_reported(tmp_path):
    with pytest.raises(InterchangeError, match="cannot read"):
        read(tmp_path / "nothing.sbj")


def test_the_fingerprint_is_short_and_stable(text):
    data = loads(text)
    assert len(fingerprint(data)) == 12
    assert fingerprint(data) == fingerprint(loads(text))


def test_the_fingerprint_changes_when_the_data_does(text):
    data = loads(text)
    other = loads(text)
    other["routes"][0]["release"] = "complete"
    assert fingerprint(data) != fingerprint(other)


def test_route_names_can_be_pulled_out(text):
    assert "K1(M)" in route_names(loads(text))
    assert route_names({}) == []


def test_to_text_is_what_dumps_uses(text, kingsmoor):
    assert to_text(as_dict(kingsmoor, build_interlocking(kingsmoor))) == text
