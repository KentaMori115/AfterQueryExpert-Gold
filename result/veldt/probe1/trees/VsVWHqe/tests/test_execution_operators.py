"""Tests for the physical operators."""

from __future__ import annotations

import pytest

from veldt.core.table import Table
from veldt.errors import ExecutionError, PlanningError
from veldt.execution.context import ExecutionContext
from veldt.execution.operators.aggregate import HashAggregateOperator, unwrap_aggregate
from veldt.execution.operators.distinct import DistinctOperator
from veldt.execution.operators.filter import FilterOperator
from veldt.execution.operators.limit import LimitOperator
from veldt.execution.operators.project import ProjectOperator
from veldt.execution.operators.scan import ScanOperator
from veldt.execution.operators.sort import SortOperator
from veldt.execution.operators.intersect import ExceptOperator, IntersectOperator
from veldt.execution.operators.union import UnionOperator
from veldt.expr.parser import ExpressionParser, parse_expression
from veldt.expr.tokenizer import tokenize
from veldt.plan.logical import Aggregate, Scan, SortKey
from veldt.storage.memory import MemorySource
from veldt.types.dtypes import DataType


@pytest.fixture
def source(orders):
    return MemorySource("orders", orders)


@pytest.fixture
def context():
    return ExecutionContext()


def aliased(source: str):
    return ExpressionParser(tokenize(source), source).parse_aliased_expression()


def aggregation(source, groups, aggregates):
    node = Aggregate(
        Scan(source),
        tuple(parse_expression(item) for item in groups),
        tuple(parse_expression(item) for item in aggregates),
    )
    return HashAggregateOperator(
        ScanOperator(source), node.group_by, node.aggregates, node.schema
    )


class TestScanOperator:
    def test_emits_every_row(self, source, context):
        assert ScanOperator(source).collect(context).num_rows == 6

    def test_honours_the_projection(self, source, context):
        operator = ScanOperator(source, ["id", "region"])
        assert operator.schema.names == ["id", "region"]
        assert operator.collect(context).schema.names == ["id", "region"]

    def test_respects_the_context_batch_size(self, source):
        context = ExecutionContext(batch_size=2)
        assert len(list(ScanOperator(source).execute(context))) == 3

    def test_records_row_metrics(self, source, context):
        ScanOperator(source).collect(context)
        assert context.metrics.counter("ScanOperator.rows") == 6

    def test_describes_its_table(self, source):
        assert "orders" in ScanOperator(source).describe()


class TestFilterOperator:
    def test_keeps_matching_rows(self, source, context):
        operator = FilterOperator(ScanOperator(source), parse_expression("amount > 50"))
        assert operator.collect(context).num_rows == 3

    def test_a_null_predicate_drops_the_row(self, source, context):
        operator = FilterOperator(ScanOperator(source), parse_expression("amount > 0"))
        assert operator.collect(context).num_rows == 5

    def test_counts_the_rows_it_dropped(self, source, context):
        FilterOperator(ScanOperator(source), parse_expression("amount > 50")).collect(context)
        assert context.metrics.counter("filter.rows_dropped") == 3

    def test_an_empty_result_yields_no_batches(self, source, context):
        operator = FilterOperator(ScanOperator(source), parse_expression("amount > 1000"))
        assert list(operator.execute(context)) == []


class TestProjectOperator:
    def test_computes_new_columns(self, source, context):
        expressions = (aliased("amount * 2 AS doubled"),)
        from veldt.expr.resolver import ExpressionResolver

        schema = ExpressionResolver().resolve_schema(expressions, source.schema)
        operator = ProjectOperator(ScanOperator(source), expressions, schema)
        assert operator.collect(context).column_names == ["doubled"]
        assert operator.collect(context).row(0)["doubled"] == 240.0

    def test_preserves_row_order(self, source, context):
        expressions = (parse_expression("id"),)
        from veldt.expr.resolver import ExpressionResolver

        schema = ExpressionResolver().resolve_schema(expressions, source.schema)
        operator = ProjectOperator(ScanOperator(source), expressions, schema)
        assert [row["id"] for row in operator.collect(context).rows()] == [1, 2, 3, 4, 5, 6]


class TestLimitOperator:
    def test_caps_the_row_count(self, source, context):
        assert LimitOperator(ScanOperator(source), 2).collect(context).num_rows == 2

    def test_applies_the_offset(self, source, context):
        table = LimitOperator(ScanOperator(source), 2, 2).collect(context)
        assert [row["id"] for row in table.rows()] == [3, 4]

    def test_an_offset_beyond_the_input_yields_nothing(self, source, context):
        assert LimitOperator(ScanOperator(source), None, 99).collect(context).num_rows == 0

    def test_a_zero_limit_yields_nothing(self, source, context):
        assert LimitOperator(ScanOperator(source), 0).collect(context).num_rows == 0

    def test_no_limit_passes_everything_through(self, source, context):
        assert LimitOperator(ScanOperator(source), None).collect(context).num_rows == 6

    def test_it_stops_pulling_early(self, source):
        context = ExecutionContext(batch_size=1)
        LimitOperator(ScanOperator(source), 2).collect(context)
        assert context.metrics.counter("ScanOperator.batches") == 2

    def test_negative_bounds_are_rejected(self, source):
        with pytest.raises(ValueError):
            LimitOperator(ScanOperator(source), -1)


class TestSortOperator:
    def test_orders_ascending_with_nulls_first(self, source, context):
        operator = SortOperator(ScanOperator(source), [SortKey(parse_expression("amount"))])
        amounts = [row["amount"] for row in operator.collect(context).rows()]
        assert amounts[0] is None
        assert amounts[1:] == sorted(value for value in amounts if value is not None)

    def test_orders_descending_with_nulls_last(self, source, context):
        operator = SortOperator(
            ScanOperator(source), [SortKey(parse_expression("amount"), ascending=False)]
        )
        amounts = [row["amount"] for row in operator.collect(context).rows()]
        assert amounts[-1] is None
        assert amounts[0] == 200.0

    def test_null_placement_can_be_overridden(self, source, context):
        operator = SortOperator(
            ScanOperator(source),
            [SortKey(parse_expression("amount"), ascending=True, nulls_first=False)],
        )
        assert [row["amount"] for row in operator.collect(context).rows()][-1] is None

    def test_secondary_keys_break_ties(self, source, context):
        operator = SortOperator(
            ScanOperator(source),
            [
                SortKey(parse_expression("region")),
                SortKey(parse_expression("id"), ascending=False),
            ],
        )
        rows = [(row["region"], row["id"]) for row in operator.collect(context).rows()]
        assert rows[0] == ("ap", 6)
        assert rows[1] == ("eu", 5)

    def test_sorting_by_an_expression(self, source, context):
        operator = SortOperator(
            ScanOperator(source), [SortKey(parse_expression("length(customer)"))]
        )
        assert operator.collect(context).num_rows == 6

    def test_it_reports_as_blocking(self, source):
        assert SortOperator(ScanOperator(source), [SortKey(parse_expression("id"))]).is_blocking

    def test_it_requires_a_key(self, source):
        with pytest.raises(ValueError):
            SortOperator(ScanOperator(source), [])


class TestAggregateOperator:
    def test_groups_and_counts(self, source, context):
        table = aggregation(source, ["region"], ["count(*)"]).collect(context)
        assert {row["region"]: row["count(*)"] for row in table.rows()} == {
            "eu": 3,
            "us": 2,
            "ap": 1,
        }

    def test_groups_are_emitted_in_first_seen_order(self, source, context):
        table = aggregation(source, ["region"], ["count(*)"]).collect(context)
        assert [row["region"] for row in table.rows()] == ["eu", "us", "ap"]

    def test_sum_ignores_nulls(self, source, context):
        table = aggregation(source, ["region"], ["sum(amount)"]).collect(context)
        assert table.row(0)["sum(amount)"] == pytest.approx(135.25)

    def test_count_of_a_column_ignores_nulls(self, source, context):
        table = aggregation(source, ["region"], ["count(amount)"]).collect(context)
        assert table.row(0)["count(amount)"] == 2

    def test_distinct_aggregates_deduplicate(self, source, context):
        table = aggregation(source, [], ["count(DISTINCT region)"]).collect(context)
        assert table.row(0)["count(DISTINCT region)"] == 3

    def test_a_global_aggregate_produces_one_row(self, source, context):
        table = aggregation(source, [], ["count(*)", "max(amount)"]).collect(context)
        assert table.num_rows == 1
        assert table.row(0)["max(amount)"] == 200.0

    def test_a_global_aggregate_over_no_rows_still_produces_a_row(self, source, context):
        empty = FilterOperator(ScanOperator(source), parse_expression("amount > 1000"))
        node = Aggregate(Scan(source), (), (parse_expression("count(*)"),))
        operator = HashAggregateOperator(empty, node.group_by, node.aggregates, node.schema)
        table = operator.collect(context)
        assert table.num_rows == 1
        assert table.row(0)["count(*)"] == 0

    def test_a_grouped_aggregate_over_no_rows_produces_nothing(self, source, context):
        empty = FilterOperator(ScanOperator(source), parse_expression("amount > 1000"))
        node = Aggregate(Scan(source), (parse_expression("region"),), (parse_expression("count(*)"),))
        operator = HashAggregateOperator(empty, node.group_by, node.aggregates, node.schema)
        assert operator.collect(context).num_rows == 0

    def test_null_group_keys_form_their_own_group(self, context):
        table = Table.from_dicts([{"g": None, "v": 1}, {"g": None, "v": 2}, {"g": "a", "v": 3}])
        source = MemorySource("t", table)
        result = aggregation(source, ["g"], ["count(*)"]).collect(context)
        assert result.num_rows == 2

    def test_group_keys_of_different_types_stay_separate(self, context):
        table = Table.from_dicts([{"g": 1}, {"g": "1"}])
        source = MemorySource("t", table)
        assert aggregation(source, ["g"], ["count(*)"]).collect(context).num_rows == 2

    def test_it_counts_the_groups(self, source, context):
        aggregation(source, ["region"], ["count(*)"]).collect(context)
        assert context.metrics.counter("aggregate.groups") == 3

    def test_non_aggregate_expressions_are_rejected(self):
        with pytest.raises(PlanningError):
            unwrap_aggregate(parse_expression("amount + 1"))

    def test_an_aliased_aggregate_is_accepted(self):
        assert unwrap_aggregate(aliased("sum(amount) AS total")).name == "sum"


class TestDistinctOperator:
    def test_removes_duplicate_rows(self, context):
        table = Table.from_dicts([{"a": 1}, {"a": 1}, {"a": 2}])
        operator = DistinctOperator(ScanOperator(MemorySource("t", table)))
        assert operator.collect(context).num_rows == 2

    def test_it_keeps_the_first_occurrence(self, context):
        table = Table.from_dicts([{"a": 2}, {"a": 1}, {"a": 2}])
        operator = DistinctOperator(ScanOperator(MemorySource("t", table)))
        assert [row["a"] for row in operator.collect(context).rows()] == [2, 1]

    def test_nulls_are_equal_to_each_other(self, context):
        table = Table.from_dicts([{"a": None}, {"a": None}])
        operator = DistinctOperator(ScanOperator(MemorySource("t", table)))
        assert operator.collect(context).num_rows == 1

    def test_a_subset_restricts_the_comparison(self, source, context):
        operator = DistinctOperator(ScanOperator(source), ["region"])
        assert operator.collect(context).num_rows == 3

    def test_it_deduplicates_across_batches(self, source):
        context = ExecutionContext(batch_size=1)
        operator = DistinctOperator(ScanOperator(source), ["region"])
        assert operator.collect(context).num_rows == 3


class TestUnionOperator:
    def test_concatenates_both_inputs(self, source, context):
        schema = source.schema
        operator = UnionOperator(ScanOperator(source), ScanOperator(source), schema)
        assert operator.collect(context).num_rows == 12

    def test_it_does_not_deduplicate(self, context):
        table = Table.from_dicts([{"a": 1}])
        source = MemorySource("t", table)
        operator = UnionOperator(ScanOperator(source), ScanOperator(source), table.schema)
        assert operator.collect(context).num_rows == 2

    def test_the_left_side_comes_first(self, context):
        left = MemorySource("l", Table.from_dicts([{"a": 1}]))
        right = MemorySource("r", Table.from_dicts([{"a": 2}]))
        operator = UnionOperator(ScanOperator(left), ScanOperator(right), left.schema)
        assert [row["a"] for row in operator.collect(context).rows()] == [1, 2]


class TestIntersectOperator:
    def test_keeps_common_rows_distinct(self, context):
        left = MemorySource("l", Table.from_dicts([{"a": 1}, {"a": 2}, {"a": 1}]))
        right = MemorySource("r", Table.from_dicts([{"a": 1}, {"a": 3}]))
        schema = left.schema
        op = IntersectOperator(ScanOperator(left), ScanOperator(right), schema, all_=False)
        result = op.collect(context)
        assert [row["a"] for row in result.rows()] == [1]

    def test_empty_when_no_overlap(self, context):
        left = MemorySource("l", Table.from_dicts([{"a": 1}]))
        right = MemorySource("r", Table.from_dicts([{"a": 2}]))
        schema = left.schema
        op = IntersectOperator(ScanOperator(left), ScanOperator(right), schema, all_=False)
        assert op.collect(context).num_rows == 0

    def test_all_keeps_min_copies(self, context):
        left = MemorySource("l", Table.from_dicts([{"a": 1}, {"a": 1}, {"a": 1}]))
        right = MemorySource("r", Table.from_dicts([{"a": 1}, {"a": 1}]))
        schema = left.schema
        op = IntersectOperator(ScanOperator(left), ScanOperator(right), schema, all_=True)
        result = op.collect(context)
        assert result.num_rows == 2  # min(3, 2)
        assert all(row["a"] == 1 for row in result.rows())

    def test_null_rows_match(self, context):
        left = MemorySource("l", Table.from_dicts([{"a": None}]))
        right = MemorySource("r", Table.from_dicts([{"a": None}]))
        schema = left.schema
        op = IntersectOperator(ScanOperator(left), ScanOperator(right), schema, all_=False)
        assert op.collect(context).num_rows == 1

    def test_describes_itself(self, context):
        left = MemorySource("l", Table.from_dicts([{"a": 1}]))
        right = MemorySource("r", Table.from_dicts([{"a": 1}]))
        schema = left.schema
        op = IntersectOperator(ScanOperator(left), ScanOperator(right), schema, all_=False)
        assert "Intersect" in op.describe()


class TestExceptOperator:
    def test_removes_right_rows_distinct(self, context):
        left = MemorySource("l", Table.from_dicts([{"a": 1}, {"a": 2}, {"a": 1}]))
        right = MemorySource("r", Table.from_dicts([{"a": 1}]))
        schema = left.schema
        op = ExceptOperator(ScanOperator(left), ScanOperator(right), schema, all_=False)
        result = op.collect(context)
        assert [row["a"] for row in result.rows()] == [2]

    def test_empty_when_all_removed(self, context):
        left = MemorySource("l", Table.from_dicts([{"a": 1}]))
        right = MemorySource("r", Table.from_dicts([{"a": 1}]))
        schema = left.schema
        op = ExceptOperator(ScanOperator(left), ScanOperator(right), schema, all_=False)
        assert op.collect(context).num_rows == 0

    def test_all_subtracts_counts(self, context):
        left = MemorySource("l", Table.from_dicts([{"a": 1}, {"a": 1}, {"a": 1}]))
        right = MemorySource("r", Table.from_dicts([{"a": 1}]))
        schema = left.schema
        op = ExceptOperator(ScanOperator(left), ScanOperator(right), schema, all_=True)
        result = op.collect(context)
        assert result.num_rows == 2  # max(0, 3-1)
        assert all(row["a"] == 1 for row in result.rows())

    def test_all_floors_at_zero(self, context):
        left = MemorySource("l", Table.from_dicts([{"a": 1}]))
        right = MemorySource("r", Table.from_dicts([{"a": 1}, {"a": 1}, {"a": 1}]))
        schema = left.schema
        op = ExceptOperator(ScanOperator(left), ScanOperator(right), schema, all_=True)
        assert op.collect(context).num_rows == 0

    def test_null_rows_cancel(self, context):
        left = MemorySource("l", Table.from_dicts([{"a": None}, {"a": 1}]))
        right = MemorySource("r", Table.from_dicts([{"a": None}]))
        schema = left.schema
        op = ExceptOperator(ScanOperator(left), ScanOperator(right), schema, all_=False)
        result = op.collect(context)
        assert result.num_rows == 1
        assert result.row(0)["a"] == 1

    def test_describes_itself(self, context):
        left = MemorySource("l", Table.from_dicts([{"a": 1}]))
        right = MemorySource("r", Table.from_dicts([{"a": 1}]))
        schema = left.schema
        op = ExceptOperator(ScanOperator(left), ScanOperator(right), schema, all_=False)
        assert "Except" in op.describe()


class TestExecutionContext:
    def test_rejects_a_non_positive_batch_size(self):
        with pytest.raises(Exception):
            ExecutionContext(batch_size=0)

    def test_with_batch_size_shares_the_metrics(self):
        context = ExecutionContext()
        assert context.with_batch_size(10).metrics is context.metrics

    def test_child_contexts_get_fresh_metrics(self):
        context = ExecutionContext()
        assert context.child().metrics is not context.metrics

    def test_options_are_readable(self):
        context = ExecutionContext(options={"trace": True})
        assert context.option("trace") is True
        assert context.option("missing", "fallback") == "fallback"
