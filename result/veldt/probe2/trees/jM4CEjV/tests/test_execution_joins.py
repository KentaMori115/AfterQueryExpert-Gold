"""Tests for the join operators and the physical planner."""

from __future__ import annotations

import pytest

from veldt.core.table import Table
from veldt.errors import ExecutionError, PlanningError
from veldt.execution.context import ExecutionContext
from veldt.execution.operators.join import HashJoinOperator, NestedLoopJoinOperator
from veldt.execution.operators.scan import ScanOperator
from veldt.execution.physical import create_physical_plan
from veldt.expr.parser import parse_expression
from veldt.plan.logical import (
    Distinct,
    Except,
    Intersect,
    Join,
    Limit,
    Scan,
    Sort,
    SortKey,
    Union,
)
from veldt.storage.memory import MemorySource


@pytest.fixture
def left():
    return MemorySource(
        "left",
        Table.from_dicts(
            [
                {"id": 1, "name": "a"},
                {"id": 2, "name": "b"},
                {"id": None, "name": "c"},
                {"id": 1, "name": "d"},
            ]
        ),
    )


@pytest.fixture
def right():
    return MemorySource(
        "right",
        Table.from_dicts(
            [
                {"rid": 1, "score": 10},
                {"rid": 1, "score": 20},
                {"rid": 3, "score": 30},
                {"rid": None, "score": 40},
            ]
        ),
    )


@pytest.fixture
def context():
    return ExecutionContext()


def hash_join(left, right, how="inner", residual=None):
    schema = left.schema.merge(right.schema)
    return HashJoinOperator(
        ScanOperator(left),
        ScanOperator(right),
        schema,
        [(parse_expression("id"), parse_expression("rid"))],
        how,
        residual,
    )


def names_of(table):
    return [row["name"] for row in table.rows()]


class TestHashJoin:
    def test_inner_join_keeps_only_matches(self, left, right, context):
        table = hash_join(left, right).collect(context)
        assert table.num_rows == 4
        assert set(names_of(table)) == {"a", "d"}

    def test_duplicate_keys_produce_a_row_per_pair(self, left, right, context):
        table = hash_join(left, right).collect(context)
        assert names_of(table).count("a") == 2

    def test_null_keys_never_match(self, left, right, context):
        table = hash_join(left, right).collect(context)
        assert "c" not in names_of(table)

    def test_left_join_keeps_unmatched_left_rows(self, left, right, context):
        table = hash_join(left, right, "left").collect(context)
        assert table.num_rows == 6
        unmatched = [row for row in table.rows() if row["rid"] is None]
        assert {row["name"] for row in unmatched} == {"b", "c"}

    def test_right_join_keeps_unmatched_right_rows(self, left, right, context):
        table = hash_join(left, right, "right").collect(context)
        unmatched = [row for row in table.rows() if row["name"] is None]
        assert {row["score"] for row in unmatched} == {30, 40}

    def test_full_join_keeps_both_sides(self, left, right, context):
        table = hash_join(left, right, "full").collect(context)
        assert table.num_rows == 8

    def test_the_output_schema_is_the_merged_one(self, left, right, context):
        table = hash_join(left, right).collect(context)
        assert table.column_names == ["id", "name", "rid", "score"]

    def test_a_residual_predicate_filters_matches(self, left, right, context):
        table = hash_join(left, right, "inner", parse_expression("score > 15")).collect(context)
        assert table.num_rows == 2

    def test_a_residual_predicate_makes_rows_unmatched_for_outer_joins(
        self, left, right, context
    ):
        table = hash_join(left, right, "left", parse_expression("score > 15")).collect(context)
        assert table.num_rows == 4
        assert sum(1 for row in table.rows() if row["rid"] is None) == 2

    def test_it_counts_the_build_side(self, left, right, context):
        hash_join(left, right).collect(context)
        assert context.metrics.counter("join.build_rows") == 4

    def test_it_requires_at_least_one_key(self, left, right):
        with pytest.raises(ExecutionError):
            HashJoinOperator(
                ScanOperator(left), ScanOperator(right), left.schema.merge(right.schema), []
            )

    def test_an_unknown_join_type_is_rejected(self, left, right):
        with pytest.raises(ExecutionError):
            HashJoinOperator(
                ScanOperator(left),
                ScanOperator(right),
                left.schema.merge(right.schema),
                [(parse_expression("id"), parse_expression("rid"))],
                "sideways",
            )

    def test_it_works_across_small_batches(self, left, right):
        context = ExecutionContext(batch_size=1)
        assert hash_join(left, right).collect(context).num_rows == 4


class TestNestedLoopJoin:
    def test_cross_join_multiplies_the_inputs(self, left, right, context):
        operator = NestedLoopJoinOperator(
            ScanOperator(left), ScanOperator(right), left.schema.merge(right.schema), None, "cross"
        )
        assert operator.collect(context).num_rows == 16

    def test_it_evaluates_an_arbitrary_condition(self, left, right, context):
        operator = NestedLoopJoinOperator(
            ScanOperator(left),
            ScanOperator(right),
            left.schema.merge(right.schema),
            parse_expression("id < rid"),
            "inner",
        )
        # Only (1, 3), (2, 3) and the second (1, 3) qualify; null keys never do.
        assert operator.collect(context).num_rows == 3

    def test_outer_semantics_match_the_hash_join(self, left, right, context):
        nested = NestedLoopJoinOperator(
            ScanOperator(left),
            ScanOperator(right),
            left.schema.merge(right.schema),
            parse_expression("id = rid"),
            "left",
        )
        assert nested.collect(context).num_rows == hash_join(left, right, "left").collect(
            ExecutionContext()
        ).num_rows

    def test_a_cross_join_must_not_carry_a_condition(self, left, right):
        with pytest.raises(ExecutionError):
            NestedLoopJoinOperator(
                ScanOperator(left),
                ScanOperator(right),
                left.schema.merge(right.schema),
                parse_expression("id = rid"),
                "cross",
            )


class TestPhysicalPlanner:
    def test_equi_joins_become_hash_joins(self, left, right):
        plan = Join(Scan(left), Scan(right), parse_expression("id = rid"), "inner")
        assert isinstance(create_physical_plan(plan), HashJoinOperator)

    def test_non_equi_joins_become_nested_loops(self, left, right):
        plan = Join(Scan(left), Scan(right), parse_expression("id < rid"), "inner")
        assert isinstance(create_physical_plan(plan), NestedLoopJoinOperator)

    def test_cross_joins_become_nested_loops(self, left, right):
        plan = Join(Scan(left), Scan(right), None, "cross")
        assert isinstance(create_physical_plan(plan), NestedLoopJoinOperator)

    def test_a_mixed_condition_keeps_a_residual(self, left, right):
        plan = Join(
            Scan(left), Scan(right), parse_expression("id = rid AND score > 15"), "inner"
        )
        operator = create_physical_plan(plan)
        assert isinstance(operator, HashJoinOperator)
        assert operator.residual is not None

    def test_it_maps_each_logical_node(self, left):
        plan = Limit(Sort(Distinct(Scan(left)), (SortKey(parse_expression("id")),)), 2)
        operator = create_physical_plan(plan)
        assert [node.name for node in operator.walk()] == [
            "LimitOperator",
            "SortOperator",
            "DistinctOperator",
            "ScanOperator",
        ]

    def test_unions_are_planned(self, left):
        plan = Union(Scan(left), Scan(left), all=True)
        assert create_physical_plan(plan).collect(ExecutionContext()).num_rows == 8

    def test_intersections_are_planned(self, left):
        plan = Intersect(Scan(left), Scan(left), all=True)
        operator = create_physical_plan(plan)
        assert operator.name == "IntersectOperator"
        assert operator.collect(ExecutionContext()).num_rows == 4

    def test_differences_are_planned(self, left):
        plan = Except(Scan(left), Scan(left), all=True)
        operator = create_physical_plan(plan)
        assert operator.name == "ExceptOperator"
        assert operator.collect(ExecutionContext()).num_rows == 0

    def test_only_accepted_filters_are_pushed_to_the_scan(self, left):
        plan = Scan(left, filters=(parse_expression("id = 1"),))
        operator = create_physical_plan(plan)
        assert operator.pushed_filters == ()

    def test_an_unknown_node_is_rejected(self):
        class Mystery:
            pass

        with pytest.raises(PlanningError):
            create_physical_plan(Mystery())
