"""Tests for data types, fields, schemas and value semantics."""

from __future__ import annotations

from datetime import datetime

import pytest

from veldt.errors import CastError, ColumnNotFoundError, DuplicateColumnError, TypeMismatchError
from veldt.types.casting import can_cast, cast_value, coerce_value, try_cast_value
from veldt.types.dtypes import (
    DataType,
    common_type,
    infer_dtype,
    is_numeric,
    parse_dtype,
    promote,
    python_type,
    unify,
)
from veldt.types.schema import Field, Schema
from veldt.types.value import (
    coerce_bool,
    compare_values,
    format_value,
    is_null,
    sort_key,
    values_equal,
)


class TestDataType:
    def test_parses_aliases(self):
        assert parse_dtype("BIGINT") is DataType.INT64
        assert parse_dtype("varchar") is DataType.STRING
        assert parse_dtype("double") is DataType.FLOAT64
        assert parse_dtype(DataType.BOOL) is DataType.BOOL

    def test_rejects_unknown_names(self):
        with pytest.raises(ValueError):
            parse_dtype("decimal128")

    def test_infers_bool_before_int(self):
        assert infer_dtype(True) is DataType.BOOL
        assert infer_dtype(1) is DataType.INT64

    def test_infers_the_remaining_types(self):
        assert infer_dtype(None) is DataType.NULL
        assert infer_dtype(1.5) is DataType.FLOAT64
        assert infer_dtype("x") is DataType.STRING
        assert infer_dtype(datetime(2026, 1, 1)) is DataType.TIMESTAMP

    def test_python_type_maps_each_type(self):
        assert python_type(DataType.STRING) is str
        assert python_type(DataType.TIMESTAMP) is datetime

    def test_promote_widens_numerics(self):
        assert promote(DataType.INT64, DataType.FLOAT64) is DataType.FLOAT64
        assert promote(DataType.NULL, DataType.STRING) is DataType.STRING

    def test_promote_returns_none_for_incompatible_types(self):
        assert promote(DataType.STRING, DataType.INT64) is None

    def test_unify_raises_where_promote_returns_none(self):
        with pytest.raises(TypeMismatchError):
            unify(DataType.STRING, DataType.INT64)

    def test_common_type_of_nothing_is_null(self):
        assert common_type([]) is DataType.NULL

    def test_is_numeric_covers_int_and_float_only(self):
        assert is_numeric(DataType.INT64)
        assert not is_numeric(DataType.BOOL)


class TestField:
    def test_normalizes_its_type(self):
        assert Field("a", "int").dtype is DataType.INT64

    def test_rejects_an_empty_name(self):
        with pytest.raises(ValueError):
            Field("", DataType.INT64)

    def test_derivations_return_copies(self):
        original = Field("a", DataType.INT64)
        assert original.rename("b").name == "b"
        assert original.with_dtype("string").dtype is DataType.STRING
        assert original.with_nullable(False).nullable is False
        assert original.name == "a"

    def test_matches_ignores_case(self):
        assert Field("Amount", DataType.INT64).matches("amount")

    def test_round_trips_through_a_dict(self):
        original = Field("a", DataType.FLOAT64, False, {"unit": "usd"})
        assert Field.from_dict(original.to_dict()) == original


class TestSchema:
    def test_rejects_duplicate_names_ignoring_case(self):
        with pytest.raises(DuplicateColumnError):
            Schema([Field("a", DataType.INT64), Field("A", DataType.STRING)])

    def test_lookup_is_case_insensitive(self, order_schema):
        assert order_schema.index_of("AMOUNT") == 3
        assert order_schema.field("Id").name == "id"

    def test_unknown_column_suggests_a_neighbour(self, order_schema):
        with pytest.raises(ColumnNotFoundError) as error:
            order_schema.index_of("amont")
        assert "amount" in str(error.value)

    def test_select_reorders_columns(self, order_schema):
        assert order_schema.select(["status", "id"]).names == ["status", "id"]

    def test_add_and_remove_return_new_schemas(self, order_schema):
        larger = order_schema.add(Field("note", DataType.STRING))
        assert larger.names[-1] == "note"
        assert len(order_schema) == 5
        assert "id" not in larger.remove("id")

    def test_rename_only_touches_mapped_columns(self, order_schema):
        renamed = order_schema.rename({"ID": "order_id"})
        assert renamed.names[0] == "order_id"
        assert renamed.names[1] == "customer"

    def test_merge_disambiguates_collisions(self):
        left = Schema.from_pairs([("id", "int"), ("v", "int")])
        right = Schema.from_pairs([("id", "int")])
        assert left.merge(right).names == ["id", "v", "id_right"]

    def test_merge_disambiguates_repeatedly(self):
        left = Schema.from_pairs([("id", "int"), ("id_right", "int")])
        right = Schema.from_pairs([("id", "int")])
        assert left.merge(right).names == ["id", "id_right", "id_right2"]

    def test_union_widens_types_and_nullability(self):
        left = Schema([Field("v", DataType.INT64, nullable=False)])
        right = Schema([Field("w", DataType.FLOAT64, nullable=True)])
        merged = left.union(right)
        assert merged.names == ["v"]
        assert merged[0].dtype is DataType.FLOAT64
        assert merged[0].nullable is True

    def test_union_requires_matching_widths(self):
        with pytest.raises(ValueError):
            Schema.from_pairs([("a", "int")]).union(
                Schema.from_pairs([("a", "int"), ("b", "int")])
            )

    def test_equality_is_by_value(self, order_schema):
        assert order_schema == Schema(list(order_schema))

    def test_round_trips_through_a_dict(self, order_schema):
        assert Schema.from_dict(order_schema.to_dict()) == order_schema


class TestValues:
    def test_is_null_covers_none_and_nan(self):
        assert is_null(None)
        assert is_null(float("nan"))
        assert not is_null(0)

    def test_equality_with_null_is_unknown(self):
        assert values_equal(None, 1) is None
        assert values_equal(1, None) is None

    def test_equality_compares_across_int_and_float(self):
        assert values_equal(1, 1.0) is True

    def test_bool_never_equals_int(self):
        assert values_equal(True, 1) is False

    def test_comparison_with_null_is_unknown(self):
        assert compare_values(None, 5) is None

    def test_comparison_orders_each_type(self):
        assert compare_values(1, 2) == -1
        assert compare_values("b", "a") == 1
        assert compare_values(datetime(2026, 1, 2), datetime(2026, 1, 1)) == 1

    def test_comparison_rejects_unrelated_types(self):
        with pytest.raises(TypeError):
            compare_values("a", 1)

    def test_sort_key_places_nulls_deterministically(self):
        values = [3, None, 1]
        assert sorted(values, key=lambda v: sort_key(v, True))[0] is None
        assert sorted(values, key=lambda v: sort_key(v, False))[-1] is None

    def test_coerce_bool_reads_textual_truth(self):
        assert coerce_bool("yes") is True
        assert coerce_bool("0") is False
        assert coerce_bool("maybe") is None
        assert coerce_bool(None) is None

    def test_format_value_renders_each_type(self):
        assert format_value(None) == "NULL"
        assert format_value(True) == "true"
        assert format_value(2.0) == "2.0"
        assert format_value(datetime(2026, 1, 2)) == "2026-01-02 00:00:00"


class TestCasting:
    def test_can_cast_allows_null_in_both_directions(self):
        assert can_cast(DataType.NULL, DataType.INT64)
        assert can_cast(DataType.INT64, DataType.NULL)

    def test_can_cast_rejects_bool_to_timestamp(self):
        assert not can_cast(DataType.BOOL, DataType.TIMESTAMP)

    def test_null_passes_through_every_cast(self):
        assert cast_value(None, DataType.INT64) is None

    def test_string_to_number_truncates_towards_zero(self):
        assert cast_value("3.7", DataType.INT64) == 3
        assert cast_value("-3.7", DataType.INT64) == -3

    def test_number_to_string_drops_a_trailing_zero(self):
        assert cast_value(3.0, DataType.STRING) == "3"

    def test_bool_to_string_is_lowercase(self):
        assert cast_value(True, DataType.STRING) == "true"

    def test_string_to_timestamp_parses(self):
        assert cast_value("2026-05-15", DataType.TIMESTAMP) == datetime(2026, 5, 15)

    def test_failed_cast_raises(self):
        with pytest.raises(CastError):
            cast_value("abc", DataType.INT64)

    def test_try_cast_returns_none_instead(self):
        assert try_cast_value("abc", DataType.INT64) is None

    def test_coerce_refuses_to_parse_text(self):
        assert coerce_value(1, DataType.FLOAT64) == 1.0
        with pytest.raises(CastError):
            coerce_value("1", DataType.INT64)
