"""Tests for format detection, readers and writers."""

from __future__ import annotations

import json
import os
from datetime import datetime

import pytest

from veldt.core.table import Table
from veldt.errors import DataSourceError
from veldt.io.formats import Format, detect_format, format_for_extension, supported_formats
from veldt.io.readers import read_csv, read_file, read_jsonl, read_rows, source_for
from veldt.io.writers import (
    to_csv_string,
    to_jsonl_string,
    write_csv,
    write_file,
    write_jsonl,
)
from veldt.storage.csv_source import CsvSource
from veldt.storage.jsonl_source import JsonLinesSource
from veldt.types.dtypes import DataType


class TestFormatDetection:
    def test_recognises_each_extension(self):
        assert detect_format("a.csv") == Format.CSV
        assert detect_format("a.tsv") == Format.TSV
        assert detect_format("a.jsonl") == Format.JSONL
        assert detect_format("a.ndjson") == Format.JSONL

    def test_detection_ignores_case(self):
        assert detect_format("A.CSV") == Format.CSV

    def test_unknown_extensions_can_fall_back(self):
        assert detect_format("a.dat", default=Format.CSV) == Format.CSV

    def test_unknown_extensions_otherwise_raise(self):
        with pytest.raises(DataSourceError):
            detect_format("a.dat")

    def test_the_supported_list_is_exposed(self):
        assert set(supported_formats()) == {"csv", "tsv", "jsonl"}

    def test_unknown_extensions_map_to_none(self):
        assert format_for_extension(".dat") is None


class TestSourceFor:
    def test_picks_the_csv_source(self, orders_csv):
        assert isinstance(source_for(orders_csv), CsvSource)

    def test_picks_the_jsonl_source(self, orders_jsonl):
        assert isinstance(source_for(orders_jsonl), JsonLinesSource)

    def test_a_tsv_gets_a_tab_delimiter(self, tmp_path, orders):
        path = os.path.join(str(tmp_path), "orders.tsv")
        write_file(orders, path)
        assert source_for(path).delimiter == "\t"

    def test_the_format_can_be_forced(self, tmp_path, orders):
        path = os.path.join(str(tmp_path), "orders.data")
        write_csv(orders, path)
        assert source_for(path, format_name=Format.CSV).to_table().num_rows == 6


class TestReaders:
    def test_read_csv_returns_a_table(self, orders_csv):
        assert read_csv(orders_csv).num_rows == 6

    def test_read_jsonl_returns_a_table(self, orders_jsonl):
        assert read_jsonl(orders_jsonl).num_rows == 6

    def test_read_file_detects_the_format(self, orders_jsonl):
        assert read_file(orders_jsonl).num_rows == 6

    def test_the_batch_size_can_be_chosen(self, orders_csv):
        table = read_csv(orders_csv, batch_size=2)
        assert [batch.num_rows for batch in table.iter_batches()] == [2, 2, 2]

    def test_read_rows_builds_from_dictionaries(self):
        assert read_rows([{"a": 1}, {"a": 2}]).num_rows == 2


class TestWriters:
    def test_csv_starts_with_a_header(self, orders):
        assert to_csv_string(orders).splitlines()[0] == "id,customer,region,amount,status"

    def test_the_header_can_be_omitted(self, orders):
        assert to_csv_string(orders, header=False).splitlines()[0].startswith("1,")

    def test_nulls_become_empty_cells(self, orders):
        assert ",," in to_csv_string(orders)

    def test_the_null_text_can_be_chosen(self, orders):
        assert "\\N" in to_csv_string(orders, null_text="\\N")

    def test_delimiters_are_configurable(self, orders):
        assert "\t" in to_csv_string(orders, delimiter="\t")

    def test_jsonl_writes_one_object_per_row(self, orders):
        lines = to_jsonl_string(orders).splitlines()
        assert len(lines) == 6
        assert json.loads(lines[0])["customer"] == "ann"

    def test_jsonl_nulls_are_json_null(self, orders):
        assert json.loads(to_jsonl_string(orders).splitlines()[2])["amount"] is None

    def test_jsonl_renders_timestamps_as_text(self, customers):
        assert json.loads(to_jsonl_string(customers).splitlines()[0])["since"].startswith("2024")

    def test_an_empty_table_writes_only_a_header(self, order_schema):
        empty = Table.empty(order_schema)
        assert to_csv_string(empty).strip() == "id,customer,region,amount,status"
        assert to_jsonl_string(empty) == ""

    def test_write_csv_reports_the_row_count(self, tmp_path, orders):
        path = os.path.join(str(tmp_path), "out.csv")
        assert write_csv(orders, path) == 6

    def test_write_file_detects_the_format(self, tmp_path, orders):
        path = os.path.join(str(tmp_path), "out.jsonl")
        write_file(orders, path)
        assert read_file(path).num_rows == 6

    def test_an_unknown_output_format_is_rejected(self, tmp_path, orders):
        with pytest.raises(DataSourceError):
            write_file(orders, os.path.join(str(tmp_path), "out.dat"))


class TestRoundTrips:
    def test_csv_preserves_values(self, tmp_path, orders):
        path = os.path.join(str(tmp_path), "round.csv")
        write_csv(orders, path)
        assert read_csv(path).to_rows() == orders.to_rows()

    def test_csv_preserves_the_schema(self, tmp_path, orders):
        path = os.path.join(str(tmp_path), "round.csv")
        write_csv(orders, path)
        assert read_csv(path).schema.dtypes == orders.schema.dtypes

    def test_jsonl_preserves_values(self, tmp_path, orders):
        path = os.path.join(str(tmp_path), "round.jsonl")
        write_jsonl(orders, path)
        assert read_jsonl(path).to_rows() == orders.to_rows()

    def test_timestamps_survive_a_csv_round_trip(self, tmp_path, customers):
        path = os.path.join(str(tmp_path), "round.csv")
        write_csv(customers, path)
        assert read_csv(path).row(0)["since"] == datetime(2024, 1, 5)

    def test_converting_between_formats_preserves_rows(self, tmp_path, orders):
        first = os.path.join(str(tmp_path), "a.csv")
        second = os.path.join(str(tmp_path), "b.jsonl")
        write_csv(orders, first)
        write_file(read_file(first), second)
        assert read_file(second).to_rows() == orders.to_rows()

    def test_quoted_values_survive(self, tmp_path):
        table = Table.from_dicts([{"note": 'a,b "c"'}])
        path = os.path.join(str(tmp_path), "quotes.csv")
        write_csv(table, path)
        assert read_csv(path).row(0)["note"] == 'a,b "c"'
