"""Tests for hive-style partitioned sources."""

from __future__ import annotations

import os
from datetime import datetime

import pytest

from veldt.errors import DataSourceError
from veldt.expr.parser import parse_expression
from veldt.storage.partition import PartitionedSource, discover_partitions
from veldt.types.dtypes import DataType


@pytest.fixture
def source(partitioned_root) -> PartitionedSource:
    return PartitionedSource(partitioned_root, "events")


class TestDiscovery:
    def test_finds_every_data_file(self, partitioned_root):
        assert len(discover_partitions(partitioned_root)) == 3

    def test_records_the_partition_values(self, partitioned_root):
        found = discover_partitions(partitioned_root)
        assert found[0].values == (("region", "eu"), ("day", "2026-05-01"))

    def test_ignores_other_extensions(self, partitioned_root):
        with open(os.path.join(partitioned_root, "notes.txt"), "w", encoding="utf-8") as handle:
            handle.write("ignore me")
        assert len(discover_partitions(partitioned_root)) == 3

    def test_ignores_hidden_files(self, partitioned_root):
        hidden = os.path.join(partitioned_root, "region=eu", "day=2026-05-01", ".hidden.csv")
        with open(hidden, "w", encoding="utf-8") as handle:
            handle.write("id\n1\n")
        assert len(discover_partitions(partitioned_root)) == 3

    def test_a_missing_directory_is_reported(self, tmp_path):
        with pytest.raises(DataSourceError):
            discover_partitions(os.path.join(str(tmp_path), "nope"))

    def test_partitions_describe_themselves(self, partitioned_root):
        assert discover_partitions(partitioned_root)[0].describe() == "region=eu/day=2026-05-01"


class TestPartitionedSchema:
    def test_partition_keys_become_columns(self, source):
        assert source.schema.names == ["id", "amount", "region", "day"]

    def test_partition_types_are_inferred(self, source):
        assert source.schema.dtype_of("region") is DataType.STRING
        assert source.schema.dtype_of("day") is DataType.TIMESTAMP

    def test_partition_columns_are_not_nullable(self, source):
        assert source.schema.field("region").nullable is False

    def test_partition_columns_are_marked_in_metadata(self, source):
        assert source.schema.field("region").metadata["partition"] == "true"

    def test_partition_columns_are_listed(self, source):
        assert source.partition_columns == ["region", "day"]

    def test_an_empty_directory_is_rejected(self, tmp_path):
        empty = os.path.join(str(tmp_path), "empty")
        os.makedirs(empty)
        with pytest.raises(DataSourceError):
            PartitionedSource(empty)

    def test_inconsistent_partition_keys_are_rejected(self, partitioned_root):
        stray = os.path.join(partitioned_root, "region=ap")
        os.makedirs(stray)
        with open(os.path.join(stray, "part-0.csv"), "w", encoding="utf-8") as handle:
            handle.write("id,amount\n9,90\n")
        with pytest.raises(DataSourceError):
            PartitionedSource(partitioned_root)


class TestPartitionedScan:
    def test_reads_every_partition(self, source):
        assert source.to_table().num_rows == 5

    def test_fills_in_the_partition_values(self, source):
        row = source.to_table().row(0)
        assert row["region"] == "eu"
        assert row["day"] == datetime(2026, 5, 1)

    def test_projections_can_drop_file_columns(self, source):
        table = source.to_table(projection=["region", "id"])
        assert table.schema.names == ["region", "id"]
        assert table.num_rows == 5

    def test_projections_can_select_only_partition_columns(self, source):
        table = source.to_table(projection=["region"])
        assert sorted({row["region"] for row in table.rows()}) == ["eu", "us"]

    def test_statistics_sum_the_partitions(self, source):
        assert source.statistics().num_rows == 5


class TestPartitionPruning:
    def test_equality_on_a_partition_key_is_accepted(self, source):
        assert source.supports_filter_pushdown(parse_expression("region = 'eu'"))

    def test_an_in_list_on_a_partition_key_is_accepted(self, source):
        assert source.supports_filter_pushdown(parse_expression("region IN ('eu', 'us')"))

    def test_a_negated_in_list_is_declined(self, source):
        assert not source.supports_filter_pushdown(parse_expression("region NOT IN ('eu')"))

    def test_ranges_are_declined(self, source):
        assert not source.supports_filter_pushdown(parse_expression("region > 'a'"))

    def test_file_columns_are_declined(self, source):
        assert not source.supports_filter_pushdown(parse_expression("amount = 10"))

    def test_mixed_predicates_are_declined(self, source):
        assert not source.supports_filter_pushdown(
            parse_expression("region = 'eu' AND amount = 10")
        )

    def test_pruning_narrows_the_partition_list(self, source):
        kept = source.prune([parse_expression("region = 'eu'")])
        assert len(kept) == 2

    def test_pruning_applies_every_predicate(self, source):
        kept = source.prune(
            [parse_expression("region = 'eu'"), parse_expression("day = '2026-05-01'")]
        )
        assert len(kept) == 1

    def test_a_pruned_scan_reads_fewer_rows(self, source):
        rows = [
            row
            for batch in source.scan(filters=[parse_expression("region = 'us'")])
            for row in batch.rows()
        ]
        assert len(rows) == 2
        assert {row["region"] for row in rows} == {"us"}

    def test_pruning_against_a_missing_value_yields_nothing(self, source):
        assert source.prune([parse_expression("region = 'zz'")]) == []

    def test_an_in_list_keeps_matching_partitions(self, source):
        kept = source.prune([parse_expression("region IN ('us')")])
        assert len(kept) == 1
