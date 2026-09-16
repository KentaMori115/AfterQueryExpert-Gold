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
from veldt.execution.operators.setops import ExceptOperator, IntersectOperator
from veldt.execution.operators.sort import SortOperator
from veldt.execution.operators.union import UnionOperator
from veldt.expr.parser import ExpressionParser, parse_expression
from veldt.expr.tokenizer import tokenize
from veldt.plan.logical import Aggregate, Except, Intersect, Scan, SortKey
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


def sources(left_rows, right_rows):
    """Two in-memory sources built from row dictionaries."""
    return (
        MemorySource("l", Table.from_dicts(left_rows)),
        MemorySource("r", Table.from_dicts(right_rows)),
    )


def set_operator(operator_type, node_type, left_rows, right_rows, all_rows=False):
    """Build a set operator over two literal row lists."""
    left, right = sources(left_rows, right_rows)
    node = node_type(Scan(left), Scan(right), all_rows)
    return operator_type(ScanOperator(left), ScanOperator(right), node.schema, all_rows)


def values(table, name="a"):
    return [row[name] for row in table.rows()]


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

    def test_a_concatenation_does_not_block(self, source):
        operator = UnionOperator(ScanOperator(source), ScanOperator(source), source.schema)
        assert not operator.is_blocking


class TestIntersectOperator:
    def test_keeps_what_both_sides_produced(self, context):
        operator = set_operator(
            IntersectOperator, Intersect, [{"a": 1}, {"a": 2}], [{"a": 2}, {"a": 3}]
        )
        assert values(operator.collect(context)) == [2]

    def test_the_plain_spelling_emits_each_row_once(self, context):
        operator = set_operator(
            IntersectOperator, Intersect, [{"a": 1}, {"a": 1}], [{"a": 1}, {"a": 1}]
        )
        assert values(operator.collect(context)) == [1]

    def test_all_keeps_the_smaller_count(self, context):
        operator = set_operator(
            IntersectOperator,
            Intersect,
            [{"a": 1}, {"a": 1}, {"a": 1}],
            [{"a": 1}, {"a": 1}],
            all_rows=True,
        )
        assert values(operator.collect(context)) == [1, 1]

    def test_it_reports_as_blocking(self):
        operator = set_operator(IntersectOperator, Intersect, [{"a": 1}], [{"a": 1}])
        assert operator.is_blocking

    def test_types_are_compared_after_conversion(self, context):
        operator = set_operator(IntersectOperator, Intersect, [{"a": 1}], [{"a": 1.0}])
        assert values(operator.collect(context)) == [1.0]

    def test_two_nulls_are_the_same_row(self, context):
        operator = set_operator(IntersectOperator, Intersect, [{"a": None}], [{"a": None}])
        assert operator.collect(context).num_rows == 1

    def test_it_works_across_batches(self):
        context = ExecutionContext(batch_size=1)
        operator = set_operator(
            IntersectOperator,
            Intersect,
            [{"a": 1}, {"a": 2}, {"a": 3}],
            [{"a": 3}, {"a": 1}],
        )
        assert values(operator.collect(context)) == [1, 3]


class TestExceptOperator:
    def test_keeps_the_rows_the_right_side_never_produced(self, context):
        operator = set_operator(
            ExceptOperator, Except, [{"a": 1}, {"a": 2}], [{"a": 2}, {"a": 3}]
        )
        assert values(operator.collect(context)) == [1]

    def test_the_plain_spelling_removes_every_copy(self, context):
        operator = set_operator(
            ExceptOperator, Except, [{"a": 1}, {"a": 1}, {"a": 2}], [{"a": 1}]
        )
        assert values(operator.collect(context)) == [2]

    def test_all_subtracts_counts(self, context):
        operator = set_operator(
            ExceptOperator,
            Except,
            [{"a": 1}, {"a": 1}, {"a": 1}],
            [{"a": 1}],
            all_rows=True,
        )
        assert values(operator.collect(context)) == [1, 1]

    def test_all_floors_at_zero(self, context):
        operator = set_operator(
            ExceptOperator, Except, [{"a": 1}], [{"a": 1}, {"a": 1}], all_rows=True
        )
        assert operator.collect(context).num_rows == 0

    def test_each_right_copy_cancels_the_earliest_left_copy(self, context):
        operator = set_operator(
            ExceptOperator,
            Except,
            [{"a": 1}, {"a": 2}, {"a": 1}],
            [{"a": 1}],
            all_rows=True,
        )
        assert values(operator.collect(context)) == [2, 1]

    def test_two_nulls_cancel(self, context):
        operator = set_operator(ExceptOperator, Except, [{"a": None}], [{"a": None}])
        assert operator.collect(context).num_rows == 0

    def test_it_reports_as_blocking(self):
        operator = set_operator(ExceptOperator, Except, [{"a": 1}], [{"a": 1}])
        assert operator.is_blocking

    def test_it_counts_what_it_dropped(self, context):
        operator = set_operator(ExceptOperator, Except, [{"a": 1}, {"a": 2}], [{"a": 1}])
        operator.collect(context)
        assert context.metrics.counter("except.rows_dropped") == 1


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
