"""Tests for schemas and fields."""

from __future__ import annotations

import pytest

from slateql.errors import AmbiguousColumnError, SchemaError, UnknownColumnError
from slateql.types.datatypes import DOUBLE, INTEGER, STRING
from slateql.types.schema import Field, Schema


def make_schema() -> Schema:
    return Schema(
        [
            Field("id", INTEGER, "t"),
            Field("name", STRING, "t"),
            Field("id", INTEGER, "u"),
        ]
    )


def test_index_of_requires_a_qualifier_when_ambiguous():
    schema = make_schema()
    with pytest.raises(AmbiguousColumnError):
        schema.index_of("id")
    assert schema.index_of("id", "u") == 2


def test_unknown_column_suggests_a_close_match():
    schema = Schema.of(("name", STRING))
    with pytest.raises(UnknownColumnError) as info:
        schema.index_of("nmae")
    assert "name" in str(info.value)


def test_try_index_of_returns_none_instead_of_raising():
    assert Schema.of(("a", INTEGER)).try_index_of("b") is None
    assert make_schema().try_index_of("id") is None


def test_project_selects_and_reorders():
    schema = Schema.of(("a", INTEGER), ("b", STRING), ("c", DOUBLE))
    assert schema.project([2, 0]).names == ["c", "a"]


def test_project_rejects_out_of_range_indices():
    with pytest.raises(SchemaError):
        Schema.of(("a", INTEGER)).project([5])


def test_merge_concatenates():
    left = Schema.of(("a", INTEGER))
    right = Schema.of(("b", STRING))
    assert left.merge(right).names == ["a", "b"]


def test_qualified_rewrites_every_field():
    schema = Schema.of(("a", INTEGER)).qualified("t")
    assert schema.qualified_names == ["t.a"]


def test_rename_requires_matching_arity():
    with pytest.raises(SchemaError):
        Schema.of(("a", INTEGER)).rename(["x", "y"])


def test_with_nullable_widens_every_field():
    schema = Schema([Field("a", INTEGER.as_nullable(False))])
    assert schema.with_nullable(True)[0].dtype.nullable


def test_indices_for_qualifier():
    assert make_schema().indices_for_qualifier("t") == [0, 1]


def test_schema_equality_and_hashing():
    assert Schema.of(("a", INTEGER)) == Schema.of(("a", INTEGER))
    assert hash(Schema.of(("a", INTEGER))) == hash(Schema.of(("a", INTEGER)))


def test_describe_renders_one_line_per_field():
    text = Schema.of(("a", INTEGER), ("bb", STRING)).describe()
    assert text.splitlines() == ["a   INTEGER", "bb  STRING"]


def test_empty_schema_describes_itself():
    assert Schema.empty().describe() == "(no columns)"


def test_field_qualified_name():
    assert Field("a", INTEGER, "t").qualified_name == "t.a"
    assert Field("a", INTEGER).qualified_name == "a"
