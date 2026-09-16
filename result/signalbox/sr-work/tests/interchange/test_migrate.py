"""Files written by an older version have to still be readable."""

from __future__ import annotations

import copy
import json

import pytest

from signalbox.interchange.json_io import InterchangeError, dumps, loads
from signalbox.interchange.migrate import (
    MIGRATIONS,
    migrate,
    needs_migrating,
    path_from,
)
from signalbox.interchange.model import SCHEMA_VERSION
from signalbox.signalling.interlocking import build_interlocking


@pytest.fixture
def current(kingsmoor):
    return json.loads(dumps(kingsmoor, build_interlocking(kingsmoor)))


@pytest.fixture
def old(current):
    """The same file as version 1 would have written it."""
    found = copy.deepcopy(current)
    found["schema"] = 1
    del found["standards"]
    del found["crossings"]
    del found["traps"]
    for edge in found["track"]:
        del edge["mileage"]
    return found


def test_a_current_file_needs_nothing_doing_to_it(current):
    assert not needs_migrating(current)
    assert migrate(current) == current


def test_an_old_file_needs_migrating(old):
    assert needs_migrating(old)


def test_migrating_brings_the_version_up(old):
    assert migrate(old)["schema"] == SCHEMA_VERSION


def test_the_new_fields_come_out_empty(old):
    found = migrate(old)
    assert found["standards"] == {}
    assert found["crossings"] == []
    assert found["traps"] == []


def test_mileage_comes_out_null(old):
    found = migrate(old)
    assert all(edge["mileage"] is None for edge in found["track"])


def test_nothing_that_was_there_is_lost(old, current):
    found = migrate(old)
    assert [route["name"] for route in found["routes"]] == [
        route["name"] for route in current["routes"]
    ]


def test_an_old_file_can_be_read_straight_off(old):
    found = loads(json.dumps(old))
    assert found["schema"] == SCHEMA_VERSION
    assert found["crossings"] == []


def test_a_file_from_a_version_with_no_migration_is_refused(old):
    ancient = copy.deepcopy(old)
    ancient["schema"] = 0
    with pytest.raises(InterchangeError, match="no migration from schema 0"):
        loads(json.dumps(ancient))


def test_there_is_a_migration_for_every_older_version():
    for version in range(1, SCHEMA_VERSION):
        assert version in MIGRATIONS, version


def test_the_path_from_a_version_is_the_steps_it_takes():
    assert path_from(SCHEMA_VERSION) == []
    assert path_from(1) == list(range(1, SCHEMA_VERSION))


def test_a_migration_that_did_not_move_on_is_caught(monkeypatch):
    monkeypatch.setitem(MIGRATIONS, 1, lambda data: {**data, "schema": 1})
    with pytest.raises(RuntimeError, match="did not move the version on"):
        migrate({"schema": 1})
