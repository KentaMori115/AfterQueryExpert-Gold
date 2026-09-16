"""Tests for data sources, the catalog, and statistics."""

from __future__ import annotations

import datetime as dt
from pathlib import Path

import pytest

from slateql.errors import StorageError, UnknownTableError
from slateql.storage.catalog import Catalog
from slateql.storage.column import ColumnView, columns_of_rows, to_column_dict
from slateql.storage.index import HashIndex, SortedIndex
from slateql.storage.schema_infer import infer_field_type, parse_scalar, widen
from slateql.storage.sources import CsvSource, JsonlSource, MemorySource
from slateql.storage.stats import compute_statistics
from slateql.types.datatypes import DOUBLE, INTEGER, STRING, TypeKind
from slateql.types.schema import Schema


def test_memory_source_rejects_ragged_rows():
    with pytest.raises(StorageError):
        MemorySource(Schema.of(("a", INTEGER)), [[1, 2]])


def test_memory_source_copies_rows():
    rows = [[1]]
    source = MemorySource(Schema.of(("a", INTEGER)), rows)
    rows[0][0] = 99
    assert source.materialize() == [[1]]


def test_memory_source_projection():
    source = MemorySource(Schema.of(("a", INTEGER), ("b", INTEGER)), [[1, 2]])
    assert source.materialize([1, 0]) == [[2, 1]]


def test_from_dicts_orders_columns_by_first_appearance():
    source = MemorySource.from_dicts([{"b": 1, "a": 2}, {"c": 3}])
    assert source.schema.names == ["b", "a", "c"]
    assert source.materialize() == [[1, 2, None], [None, None, 3]]


def test_from_columns_requires_equal_lengths():
    with pytest.raises(StorageError):
        MemorySource.from_columns({"a": [1, 2], "b": [3]})


def test_csv_infers_types(csv_path: Path):
    source = CsvSource(csv_path)
    kinds = [field.dtype.kind for field in source.schema]
    assert kinds == [
        TypeKind.INTEGER,
        TypeKind.STRING,
        TypeKind.DOUBLE,
        TypeKind.DATE,
        TypeKind.BOOLEAN,
    ]


def test_csv_blank_cell_becomes_null(csv_path: Path):
    rows = CsvSource(csv_path).materialize()
    assert rows[2][2] is None


def test_csv_reports_row_width_mismatch(tmp_path: Path):
    target = tmp_path / "bad.csv"
    target.write_text("a,b\n1,2\n3\n", encoding="utf-8")
    with pytest.raises(StorageError) as info:
        CsvSource(target).materialize()
    assert "expected 2 fields" in str(info.value)


def test_csv_without_header_generates_names(tmp_path: Path):
    target = tmp_path / "noheader.csv"
    target.write_text("1,2\n3,4\n", encoding="utf-8")
    source = CsvSource(target, has_header=False)
    assert source.schema.names == ["column1", "column2"]
    assert source.materialize() == [[1, 2], [3, 4]]


def test_csv_empty_file_is_rejected(tmp_path: Path):
    target = tmp_path / "empty.csv"
    target.write_text("", encoding="utf-8")
    with pytest.raises(StorageError):
        CsvSource(target).schema


def test_csv_missing_file_is_reported(tmp_path: Path):
    with pytest.raises(StorageError):
        CsvSource(tmp_path / "nope.csv").schema


def test_jsonl_missing_key_becomes_null(jsonl_path: Path):
    rows = JsonlSource(jsonl_path).materialize()
    assert rows[2] == [3, "gamma", None]


def test_jsonl_rejects_nested_values(tmp_path: Path):
    target = tmp_path / "nested.jsonl"
    target.write_text('{"a": {"b": 1}}\n', encoding="utf-8")
    with pytest.raises(StorageError) as info:
        JsonlSource(target).materialize()
    assert "nested" in str(info.value)


def test_jsonl_rejects_non_object_lines(tmp_path: Path):
    target = tmp_path / "array.jsonl"
    target.write_text("[1, 2]\n", encoding="utf-8")
    with pytest.raises(StorageError):
        JsonlSource(target).materialize()


def test_jsonl_reports_invalid_json_with_a_line_number(tmp_path: Path):
    target = tmp_path / "broken.jsonl"
    target.write_text('{"a": 1}\nnot json\n', encoding="utf-8")
    with pytest.raises(StorageError) as info:
        JsonlSource(target).materialize()
    assert ":2:" in str(info.value)


def test_catalog_lookup_is_case_insensitive_by_default():
    catalog = Catalog()
    catalog.register_dicts("People", [{"a": 1}])
    assert catalog.get("people").name == "People"


def test_catalog_case_sensitive_mode():
    catalog = Catalog(case_sensitive=True)
    catalog.register_dicts("People", [{"a": 1}])
    with pytest.raises(UnknownTableError):
        catalog.get("people")


def test_catalog_unknown_table_suggests_a_close_name():
    catalog = Catalog()
    catalog.register_dicts("orders", [{"a": 1}])
    with pytest.raises(UnknownTableError) as info:
        catalog.get("order")
    assert "orders" in str(info.value)


def test_catalog_drop_reports_whether_anything_was_removed():
    catalog = Catalog()
    catalog.register_dicts("t", [{"a": 1}])
    assert catalog.drop("t") is True
    assert catalog.drop("t") is False


def test_statistics_track_nulls_and_extremes():
    schema = Schema.of(("a", INTEGER))
    stats = compute_statistics(schema, [[1], [None], [5], [3]])
    column = stats.column("a")
    assert stats.row_count == 4
    assert column.null_count == 1
    assert (column.minimum, column.maximum) == (1, 5)
    assert column.distinct_count == 3


def test_statistics_selectivity_is_bounded():
    schema = Schema.of(("a", INTEGER))
    stats = compute_statistics(schema, [[i] for i in range(10)])
    assert 0.0 <= stats.column("a").selectivity_for_equality(10) <= 1.0


def test_table_estimated_row_count_uses_the_source():
    catalog = Catalog()
    table = catalog.register_dicts("t", [{"a": 1}, {"a": 2}])
    assert table.estimated_row_count() == 2


def test_hash_index_ignores_nulls():
    schema = Schema.of(("a", INTEGER))
    index = HashIndex(schema, "a").build([[1], [None], [1]])
    assert index.lookup(1) == [0, 2]
    assert index.lookup(None) == []
    assert index.null_offsets() == [1]
    assert index.stats().distinct_keys == 1


def test_sorted_index_range_scan():
    schema = Schema.of(("a", INTEGER))
    index = SortedIndex(schema, "a").build([[3], [1], [None], [2]])
    assert index.range(low=2) == [3, 0]
    assert index.range(low=1, high=2, include_high=False) == [1]


def test_column_view_helpers():
    schema = Schema.of(("a", INTEGER), ("b", STRING))
    rows = [[1, "x"], [None, "y"], [1, "z"]]
    views = columns_of_rows(schema, rows)
    assert isinstance(views[0], ColumnView)
    assert views[0].null_count() == 1
    assert views[0].distinct() == [1]
    assert to_column_dict(schema, rows)["b"] == ["x", "y", "z"]


def test_parse_scalar_narrows_text():
    assert parse_scalar("12") == 12
    assert parse_scalar("1.5") == 1.5
    assert parse_scalar("true") is True
    assert parse_scalar("2024-01-01") == dt.date(2024, 1, 1)
    assert parse_scalar("hello") == "hello"
    assert parse_scalar("  ") is None


def test_infer_field_type_ladder():
    assert infer_field_type([True, False]).kind is TypeKind.BOOLEAN
    assert infer_field_type([1, 2]).kind is TypeKind.INTEGER
    assert infer_field_type([1, 2.5]).kind is TypeKind.DOUBLE
    assert infer_field_type([1, "x"]).kind is TypeKind.STRING


def test_widen_picks_the_later_ladder_entry():
    assert widen(INTEGER, DOUBLE).kind is TypeKind.DOUBLE
    assert widen(INTEGER, STRING).kind is TypeKind.STRING


def test_looks_temporal_requires_an_iso_prefix():
    from slateql.storage.schema_infer import looks_temporal

    assert looks_temporal("2024-01-01")
    assert looks_temporal("2024-01-01T10:00:00")
    assert not looks_temporal("20240101")
    assert not looks_temporal("2024")


def test_coerce_json_scalar_leaves_numbers_alone():
    from slateql.storage.schema_infer import coerce_json_scalar

    assert coerce_json_scalar(12) == 12
    assert coerce_json_scalar("gamma") == "gamma"
    assert coerce_json_scalar("2024-01-01") == dt.date(2024, 1, 1)
    assert isinstance(coerce_json_scalar("2024-01-01T05:00:00"), dt.datetime)


def test_jsonl_infers_timestamps_from_iso_strings(tmp_path: Path):
    target = tmp_path / "times.jsonl"
    target.write_text(
        '{"id": 1, "at": "2024-01-01T05:00:00"}\n'
        '{"id": 2, "at": "2024-01-02T06:00:00"}\n',
        encoding="utf-8",
    )
    source = JsonlSource(target)
    assert source.schema[1].dtype.kind is TypeKind.TIMESTAMP
    assert isinstance(source.materialize()[0][1], dt.datetime)


def test_jsonl_leaves_ordinary_strings_alone(tmp_path: Path):
    target = tmp_path / "codes.jsonl"
    target.write_text('{"code": "20240101", "n": 3}\n', encoding="utf-8")
    schema = JsonlSource(target).schema
    assert schema[0].dtype.kind is TypeKind.STRING
    assert schema[1].dtype.kind is TypeKind.INTEGER
