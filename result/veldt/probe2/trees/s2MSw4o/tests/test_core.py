"""Tests for columns, batches and tables."""

from __future__ import annotations

import pytest

from veldt.core.batch import RecordBatch
from veldt.core.column import Column
from veldt.core.result import QueryResult
from veldt.core.table import Table
from veldt.errors import SchemaError
from veldt.types.dtypes import DataType
from veldt.types.schema import Field, Schema


class TestColumn:
    def test_infers_its_type_from_values(self):
        assert Column.from_values("a", [1, 2]).dtype is DataType.INT64
        assert Column.from_values("a", [1, 2.5]).dtype is DataType.FLOAT64
        assert Column.from_values("a", [None, None]).dtype is DataType.NULL

    def test_mixed_incompatible_values_fall_back_to_string(self):
        assert Column.from_values("a", [1, "x"]).dtype is DataType.STRING

    def test_take_gathers_in_the_given_order(self):
        column = Column("a", DataType.INT64, [10, 20, 30])
        assert column.take([2, 0]).values == [30, 10]

    def test_filter_keeps_only_definite_true(self):
        column = Column("a", DataType.INT64, [1, 2, 3])
        assert column.filter([True, None, False]).values == [1]

    def test_filter_rejects_a_mismatched_mask(self):
        with pytest.raises(ValueError):
            Column("a", DataType.INT64, [1]).filter([True, True])

    def test_slice_bounds_are_clamped(self):
        column = Column("a", DataType.INT64, [1, 2, 3])
        assert column.slice(1).values == [2, 3]
        assert column.slice(1, 10).values == [2, 3]

    def test_map_skips_nulls(self):
        column = Column("a", DataType.INT64, [1, None, 3])
        assert column.map(lambda v: v * 2).values == [2, None, 6]

    def test_rename_shares_the_values(self):
        column = Column("a", DataType.INT64, [1])
        assert column.rename("b").values is column.values

    def test_statistics_ignore_nulls(self):
        column = Column("a", DataType.INT64, [3, None, 1, 3])
        assert column.null_count() == 1
        assert column.distinct_count() == 2
        assert column.min_value() == 1
        assert column.max_value() == 3

    def test_statistics_of_an_all_null_column(self):
        column = Column("a", DataType.INT64, [None, None])
        assert column.is_all_null()
        assert column.min_value() is None

    def test_cast_converts_every_value(self):
        column = Column("a", DataType.INT64, [1, None]).cast(DataType.STRING)
        assert column.values == ["1", None]
        assert column.dtype is DataType.STRING

    def test_contains_uses_sql_equality(self):
        assert Column("a", DataType.INT64, [1]).contains(1.0)
        assert not Column("a", DataType.INT64, [1]).contains(2)


class TestRecordBatch:
    def test_rejects_a_column_count_mismatch(self, order_schema):
        with pytest.raises(SchemaError):
            RecordBatch(order_schema, [])

    def test_rejects_differing_column_lengths(self):
        schema = Schema.from_pairs([("a", "int"), ("b", "int")])
        columns = [Column("a", DataType.INT64, [1]), Column("b", DataType.INT64, [1, 2])]
        with pytest.raises(SchemaError):
            RecordBatch(schema, columns)

    def test_rejects_a_name_mismatch(self):
        schema = Schema.from_pairs([("a", "int")])
        with pytest.raises(SchemaError):
            RecordBatch(schema, [Column("b", DataType.INT64, [1])])

    def test_from_rows_rejects_a_short_row(self):
        schema = Schema.from_pairs([("a", "int"), ("b", "int")])
        with pytest.raises(SchemaError):
            RecordBatch.from_rows(schema, [(1,)])

    def test_from_dicts_fills_absent_keys_with_null(self):
        schema = Schema.from_pairs([("a", "int"), ("b", "int")])
        batch = RecordBatch.from_dicts(schema, [{"a": 1}])
        assert batch.row(0) == {"a": 1, "b": None}

    def test_from_dicts_matches_keys_case_insensitively(self):
        schema = Schema.from_pairs([("a", "int")])
        assert RecordBatch.from_dicts(schema, [{"A": 5}]).value(0, "a") == 5

    def test_select_reorders_and_narrows(self, orders):
        batch = orders.batches[0].select(["status", "id"])
        assert batch.schema.names == ["status", "id"]

    def test_filter_rejects_a_mismatched_mask(self, orders):
        with pytest.raises(SchemaError):
            orders.batches[0].filter([True])

    def test_with_column_replaces_by_name(self, orders):
        batch = orders.batches[0]
        replaced = batch.with_column(Column("id", DataType.STRING, ["x"] * batch.num_rows))
        assert replaced.num_columns == batch.num_columns
        assert replaced.schema.dtype_of("id") is DataType.STRING

    def test_with_column_appends_a_new_name(self, orders):
        batch = orders.batches[0]
        extended = batch.with_column(Column("note", DataType.STRING, ["n"] * batch.num_rows))
        assert extended.num_columns == batch.num_columns + 1

    def test_concat_needs_a_schema_when_empty(self):
        with pytest.raises(SchemaError):
            RecordBatch.concat([])

    def test_concat_joins_batches(self, orders):
        batch = orders.batches[0]
        assert RecordBatch.concat([batch, batch]).num_rows == batch.num_rows * 2


class TestTable:
    def test_drops_empty_batches(self, order_schema):
        empty = RecordBatch.empty(order_schema)
        assert Table(order_schema, [empty]).batches == []

    def test_rejects_a_batch_with_a_different_schema(self, orders):
        other = Schema.from_pairs([("a", "int")])
        with pytest.raises(SchemaError):
            Table(other, orders.batches)

    def test_from_rows_chunks_into_batches(self, order_schema, orders):
        table = Table.from_rows(order_schema, orders.to_rows(), batch_size=2)
        assert [batch.num_rows for batch in table.iter_batches()] == [2, 2, 2]

    def test_from_dicts_infers_a_schema(self):
        table = Table.from_dicts([{"a": 1}, {"a": None, "b": "x"}])
        assert table.schema.names == ["a", "b"]
        assert table.schema.dtype_of("b") is DataType.STRING

    def test_row_supports_negative_indexing(self, orders):
        assert orders.row(-1)["id"] == 6

    def test_row_rejects_an_out_of_range_index(self, orders):
        with pytest.raises(IndexError):
            orders.row(99)

    def test_column_concatenates_across_batches(self, order_schema, orders):
        chunked = Table.from_rows(order_schema, orders.to_rows(), batch_size=2)
        assert len(chunked.column("id")) == 6

    def test_head_stops_at_the_requested_count(self, orders):
        assert orders.head(2).num_rows == 2
        assert orders.head(0).num_rows == 0
        assert orders.head(99).num_rows == 6

    def test_rechunk_preserves_rows(self, orders):
        assert orders.rechunk(2).to_rows() == orders.to_rows()

    def test_concat_requires_matching_schemas(self, orders, customers):
        with pytest.raises(SchemaError):
            orders.concat(customers)

    def test_equals_compares_rows_and_schema(self, orders):
        assert orders.equals(Table(orders.schema, orders.batches))
        assert not orders.equals(orders.head(1))


class TestQueryResult:
    def test_exposes_table_shaped_helpers(self, orders):
        result = QueryResult(orders)
        assert len(result) == 6
        assert result.column_names[0] == "id"
        assert result.first()["id"] == 1
        assert result.column("id")[0] == 1

    def test_first_of_an_empty_result_is_none(self, order_schema):
        assert QueryResult(Table.empty(order_schema)).first() is None

    def test_scalar_requires_exactly_one_cell(self, orders):
        single = Table.from_dicts([{"n": 3}])
        assert QueryResult(single).scalar() == 3
        with pytest.raises(ValueError):
            QueryResult(orders).scalar()

    def test_explain_without_a_plan_says_so(self, orders):
        assert "no plan" in QueryResult(orders).explain()

    def test_with_metrics_merges(self, orders):
        result = QueryResult(orders, metrics={"a": 1}).with_metrics({"b": 2})
        assert result.metrics == {"a": 1, "b": 2}
