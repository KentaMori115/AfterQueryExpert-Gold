"""Tests for data sources, the catalog and caching."""

from __future__ import annotations

import os
from datetime import datetime

import pytest

from veldt.errors import (
    DataSourceError,
    TableAlreadyExistsError,
    TableNotFoundError,
)
from veldt.storage.cache import LruCache, MaterializationCache
from veldt.storage.catalog import Catalog
from veldt.storage.csv_source import CsvSource
from veldt.storage.jsonl_source import JsonLinesSource
from veldt.storage.memory import EmptySource, MemorySource
from veldt.storage.schema_infer import (
    infer_column_type,
    infer_schema,
    normalize_header,
    parse_text_value,
)
from veldt.types.dtypes import DataType
from veldt.types.schema import Field, Schema


def write(tmp_path, name, body):
    path = os.path.join(str(tmp_path), name)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(body)
    return path


class TestSchemaInference:
    def test_integers_win_over_floats(self):
        assert infer_column_type(["1", "2"]) is DataType.INT64

    def test_a_single_float_widens_the_column(self):
        assert infer_column_type(["1", "2.5"]) is DataType.FLOAT64

    def test_booleans_are_recognised(self):
        assert infer_column_type(["true", "no"]) is DataType.BOOL

    def test_zero_and_one_stay_numeric(self):
        assert infer_column_type(["0", "1"]) is DataType.INT64

    def test_timestamps_are_recognised(self):
        assert infer_column_type(["2026-05-15", "2026-06-01"]) is DataType.TIMESTAMP

    def test_anything_else_is_text(self):
        assert infer_column_type(["1", "x"]) is DataType.STRING

    def test_all_null_columns_default_to_text(self):
        assert infer_column_type(["", "null"]) is DataType.STRING

    def test_nulls_do_not_change_the_type(self):
        assert infer_column_type(["1", "", "3"]) is DataType.INT64

    def test_blank_headers_get_placeholders(self):
        assert normalize_header(["a", "", "b"]) == ["a", "column_2", "b"]

    def test_duplicate_headers_are_disambiguated(self):
        assert normalize_header(["a", "A"]) == ["a", "A_2"]

    def test_inferred_columns_are_nullable_when_gaps_exist(self):
        schema = infer_schema(["a", "b"], [["1", ""], ["2", "x"]])
        assert schema.field("a").nullable is False
        assert schema.field("b").nullable is True

    def test_unparseable_cells_become_null(self):
        assert parse_text_value("abc", DataType.INT64) is None

    def test_text_columns_keep_surrounding_space(self):
        assert parse_text_value(" a ", DataType.STRING) == " a "


class TestMemorySource:
    def test_rechunks_to_the_requested_batch_size(self, orders):
        source = MemorySource("orders", orders)
        assert [batch.num_rows for batch in source.scan(batch_size=4)] == [4, 2]

    def test_applies_the_projection(self, orders):
        source = MemorySource("orders", orders)
        batch = next(source.scan(projection=["region", "id"]))
        assert batch.schema.names == ["region", "id"]

    def test_unknown_projection_columns_are_rejected(self, orders):
        with pytest.raises(DataSourceError):
            next(MemorySource("orders", orders).scan(projection=["nope"]))

    def test_statistics_are_exact(self, orders):
        stats = MemorySource("orders", orders).statistics()
        assert stats.num_rows == 6
        assert stats.column("region").distinct_count == 3
        assert stats.column("amount").null_count == 1

    def test_head_reads_only_what_it_needs(self, orders):
        assert MemorySource("orders", orders).head(2).num_rows == 2

    def test_filter_pushdown_is_declined_by_default(self, orders):
        from veldt.expr.parser import parse_expression

        source = MemorySource("orders", orders)
        assert source.supports_filter_pushdown(parse_expression("id = 1")) is False

    def test_empty_source_yields_nothing(self, order_schema):
        source = EmptySource("empty", order_schema)
        assert list(source.scan()) == []
        assert source.statistics().num_rows == 0


class TestCsvSource:
    def test_infers_a_schema_from_the_header(self, tmp_path):
        path = write(tmp_path, "a.csv", "id,name,score\n1,ann,1.5\n2,bob,2\n")
        schema = CsvSource(path).schema
        assert schema.names == ["id", "name", "score"]
        assert schema.dtypes == [DataType.INT64, DataType.STRING, DataType.FLOAT64]

    def test_reads_typed_values(self, tmp_path):
        path = write(tmp_path, "a.csv", "id,when\n1,2026-05-15\n")
        assert CsvSource(path).to_table().to_rows() == [(1, datetime(2026, 5, 15))]

    def test_blank_cells_become_null(self, tmp_path):
        path = write(tmp_path, "a.csv", "id,score\n1,\n")
        assert CsvSource(path).to_table().to_rows() == [(1, None)]

    def test_headerless_files_get_positional_names(self, tmp_path):
        path = write(tmp_path, "a.csv", "1,ann\n2,bob\n")
        source = CsvSource(path, has_header=False)
        assert source.schema.names == ["column_1", "column_2"]
        assert source.to_table().num_rows == 2

    def test_alternative_delimiters(self, tmp_path):
        path = write(tmp_path, "a.tsv", "id\tname\n1\tann\n")
        assert CsvSource(path, delimiter="\t").to_table().to_rows() == [(1, "ann")]

    def test_quoted_fields_keep_their_commas(self, tmp_path):
        path = write(tmp_path, "a.csv", 'id,name\n1,"a,b"\n')
        assert CsvSource(path).to_table().row(0)["name"] == "a,b"

    def test_blank_lines_are_skipped(self, tmp_path):
        path = write(tmp_path, "a.csv", "id\n1\n\n2\n")
        assert CsvSource(path).to_table().num_rows == 2

    def test_explicit_schemas_skip_inference(self, tmp_path):
        path = write(tmp_path, "a.csv", "id\n1\n")
        schema = Schema([Field("id", DataType.STRING)])
        assert CsvSource(path, schema=schema).to_table().to_rows() == [("1",)]

    def test_short_rows_are_padded_with_null(self, tmp_path):
        path = write(tmp_path, "a.csv", "id,name\n1,ann\n2\n")
        assert CsvSource(path).to_table().row(1)["name"] is None

    def test_batches_respect_the_requested_size(self, tmp_path):
        rows = "".join(f"{index}\n" for index in range(5))
        path = write(tmp_path, "a.csv", "id\n" + rows)
        assert [batch.num_rows for batch in CsvSource(path).scan(batch_size=2)] == [2, 2, 1]

    def test_statistics_count_rows(self, tmp_path):
        path = write(tmp_path, "a.csv", "id\n1\n2\n")
        assert CsvSource(path).statistics().num_rows == 2

    def test_an_empty_file_cannot_be_inferred(self, tmp_path):
        path = write(tmp_path, "a.csv", "")
        with pytest.raises(DataSourceError):
            CsvSource(path).schema

    def test_a_missing_file_is_reported(self, tmp_path):
        with pytest.raises(DataSourceError):
            CsvSource(os.path.join(str(tmp_path), "nope.csv")).schema

    def test_a_multi_character_delimiter_is_rejected(self, tmp_path):
        path = write(tmp_path, "a.csv", "id\n1\n")
        with pytest.raises(ValueError):
            CsvSource(path, delimiter="||")

    def test_the_table_name_defaults_to_the_file_stem(self, tmp_path):
        assert CsvSource(write(tmp_path, "trips.csv", "id\n1\n")).name == "trips"


class TestJsonLinesSource:
    def test_infers_a_union_of_keys(self, tmp_path):
        path = write(tmp_path, "a.jsonl", '{"a": 1}\n{"a": 2, "b": "x"}\n')
        assert JsonLinesSource(path).schema.names == ["a", "b"]

    def test_absent_keys_read_as_null(self, tmp_path):
        path = write(tmp_path, "a.jsonl", '{"a": 1, "b": "x"}\n{"a": 2}\n')
        assert JsonLinesSource(path).to_table().row(1)["b"] is None

    def test_blank_lines_are_ignored(self, tmp_path):
        path = write(tmp_path, "a.jsonl", '{"a": 1}\n\n{"a": 2}\n')
        assert JsonLinesSource(path).to_table().num_rows == 2

    def test_timestamps_are_parsed_from_text(self, tmp_path):
        path = write(tmp_path, "a.jsonl", '{"t": "2026-05-15"}\n')
        schema = Schema([Field("t", DataType.TIMESTAMP)])
        assert JsonLinesSource(path, schema=schema).to_table().row(0)["t"] == datetime(2026, 5, 15)

    def test_malformed_lines_raise_by_default(self, tmp_path):
        path = write(tmp_path, "a.jsonl", '{"a": 1}\nnot json\n')
        with pytest.raises(DataSourceError):
            JsonLinesSource(path).to_table()

    def test_malformed_lines_can_be_skipped(self, tmp_path):
        path = write(tmp_path, "a.jsonl", '{"a": 1}\nnot json\n{"a": 2}\n')
        source = JsonLinesSource(path, skip_invalid=True)
        assert source.to_table().num_rows == 2
        assert source.invalid_line_count == 1

    def test_non_object_lines_are_rejected(self, tmp_path):
        path = write(tmp_path, "a.jsonl", "[1, 2]\n")
        with pytest.raises(DataSourceError):
            JsonLinesSource(path).schema

    def test_an_empty_file_cannot_be_inferred(self, tmp_path):
        with pytest.raises(DataSourceError):
            JsonLinesSource(write(tmp_path, "a.jsonl", "")).schema


class TestCatalog:
    def test_lookup_is_case_insensitive(self, orders):
        registry = Catalog()
        registry.register("Orders", MemorySource("orders", orders))
        assert registry.get("ORDERS") is registry.get("orders")

    def test_the_original_spelling_is_kept(self, orders):
        registry = Catalog()
        registry.register("Orders", MemorySource("orders", orders))
        assert registry.table_names() == ["Orders"]

    def test_duplicate_names_need_replace(self, orders):
        registry = Catalog()
        source = MemorySource("orders", orders)
        registry.register("orders", source)
        with pytest.raises(TableAlreadyExistsError):
            registry.register("orders", source)
        registry.register("orders", source, replace=True)

    def test_empty_names_are_rejected(self, orders):
        with pytest.raises(ValueError):
            Catalog().register("  ", MemorySource("orders", orders))

    def test_unknown_tables_are_reported(self):
        with pytest.raises(TableNotFoundError):
            Catalog().get("nope")

    def test_unknown_tables_suggest_a_neighbour(self, catalog):
        with pytest.raises(TableNotFoundError) as error:
            catalog.get("order")
        assert "orders" in str(error.value)

    def test_drop_removes_a_table(self, catalog):
        assert catalog.drop("orders") is True
        assert "orders" not in catalog

    def test_dropping_an_unknown_table_can_be_tolerated(self, catalog):
        assert catalog.drop("nope", missing_ok=True) is False
        with pytest.raises(TableNotFoundError):
            catalog.drop("nope")

    def test_clear_empties_the_catalog(self, catalog):
        catalog.clear()
        assert len(catalog) == 0

    def test_copies_share_sources_but_not_registrations(self, catalog, orders):
        clone = catalog.copy()
        clone.drop("orders")
        assert "orders" in catalog

    def test_describe_lists_columns(self, catalog):
        assert "orders(" in catalog.describe()


class TestCaches:
    def test_lru_evicts_the_oldest_entry(self):
        cache = LruCache(capacity=2)
        cache.put("a", 1)
        cache.put("b", 2)
        cache.put("c", 3)
        assert cache.get("a") is None
        assert cache.get("c") == 3

    def test_reading_an_entry_makes_it_recent(self):
        cache = LruCache(capacity=2)
        cache.put("a", 1)
        cache.put("b", 2)
        cache.get("a")
        cache.put("c", 3)
        assert cache.get("a") == 1
        assert cache.get("b") is None

    def test_hits_and_misses_are_counted(self):
        cache = LruCache()
        cache.put("a", 1)
        cache.get("a")
        cache.get("b")
        assert (cache.hits, cache.misses) == (1, 1)

    def test_a_zero_capacity_is_rejected(self):
        with pytest.raises(Exception):
            LruCache(capacity=0)

    def test_materialization_is_keyed_by_projection(self, orders):
        cache = MaterializationCache()
        cache.put("orders", orders)
        assert cache.get("orders") is orders
        assert cache.get("orders", ["id"]) is None

    def test_projection_order_does_not_matter(self, orders):
        cache = MaterializationCache()
        cache.put("orders", orders, ["id", "region"])
        assert cache.get("orders", ["region", "id"]) is orders

    def test_oversized_tables_are_not_cached(self, orders):
        cache = MaterializationCache(max_rows=2)
        assert cache.put("orders", orders) is False
        assert len(cache) == 0

    def test_invalidate_drops_every_projection(self, orders):
        cache = MaterializationCache()
        cache.put("orders", orders)
        cache.put("orders", orders.select(["id"]), ["id"])
        assert cache.invalidate("orders") == 2

    def test_statistics_describe_the_cache(self, orders):
        cache = MaterializationCache()
        cache.put("orders", orders)
        cache.get("orders")
        assert cache.statistics().hit_rate == 1.0
        assert "1 entries" in cache.statistics().describe()
