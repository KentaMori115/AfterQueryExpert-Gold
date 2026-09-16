"""Tests for the optimizer rules and the fixpoint driver."""

from __future__ import annotations

import pytest

from veldt.errors import PlanningError
from veldt.expr.ast import Alias, ColumnRef, Expression, Literal
from veldt.expr.parser import ExpressionParser, parse_expression
from veldt.expr.tokenizer import tokenize
from veldt.plan.builder import PlanBuilder
from veldt.plan.logical import (
    Aggregate,
    Distinct,
    Except,
    Filter,
    Intersect,
    Join,
    Limit,
    LogicalPlan,
    Project,
    Scan,
    Sort,
    SortKey,
)
from veldt.plan.optimizer import Optimizer, default_optimizer, optimize
from veldt.plan.rules import (
    CombineFilters,
    CombineLimits,
    CombineProjections,
    ConstantFolding,
    EliminateRedundantDistinct,
    PredicatePushdown,
    ProjectionPushdown,
    RemoveTrivialFilter,
    Rule,
    substitute,
)
from veldt.storage.memory import MemorySource
from veldt.types.dtypes import DataType


@pytest.fixture
def source(orders):
    return MemorySource("orders", orders)


@pytest.fixture
def customer_source(customers):
    return MemorySource("customers", customers)


def find(plan: LogicalPlan, node_type):
    return [node for node in plan.walk() if isinstance(node, node_type)]


def aliased(source: str) -> Expression:
    """Parse an expression that carries a trailing AS alias."""
    return ExpressionParser(tokenize(source), source).parse_aliased_expression()


class TestSubstitute:
    def test_replaces_matching_column_references(self):
        rewritten = substitute(
            parse_expression("total > 1"), {"total": parse_expression("amount * 2")}
        )
        assert rewritten.to_sql() == "((amount * 2) > 1)"

    def test_leaves_unmapped_references_alone(self):
        original = parse_expression("other > 1")
        assert substitute(original, {"total": Literal(1)}) == original


class TestConstantFolding:
    def test_folds_inside_a_filter(self, source):
        plan = Filter(Scan(source), parse_expression("amount > 2 * 5"))
        folded = ConstantFolding().apply(plan)
        assert folded.predicate.to_sql() == "(amount > 10)"

    def test_preserves_the_projection_name(self, source):
        plan = Project(Scan(source), (parse_expression("1 + 1"),))
        folded = ConstantFolding().apply(plan)
        assert folded.schema.names == plan.schema.names

    def test_folds_inside_a_join_condition(self, source, customer_source):
        plan = Join(
            Scan(source),
            Scan(customer_source),
            parse_expression("customer = tier AND 1 = 1"),
            "inner",
        )
        folded = ConstantFolding().apply(plan)
        assert "1 = 1" not in folded.condition.to_sql()


class TestFilterRules:
    def test_adjacent_filters_merge(self, source):
        plan = Filter(Filter(Scan(source), parse_expression("id > 1")), parse_expression("id < 5"))
        merged = CombineFilters().apply(plan)
        assert len(find(merged, Filter)) == 1

    def test_repeated_terms_are_dropped(self, source):
        plan = Filter(
            Filter(Scan(source), parse_expression("id > 1")), parse_expression("id > 1")
        )
        merged = CombineFilters().apply(plan)
        assert merged.predicate.to_sql() == "(id > 1)"

    def test_always_true_filters_disappear(self, source):
        plan = Filter(Scan(source), Literal(True, DataType.BOOL))
        assert isinstance(RemoveTrivialFilter().apply(plan), Scan)

    def test_always_false_filters_become_an_empty_limit(self, source):
        plan = Filter(Scan(source), Literal(False, DataType.BOOL))
        rewritten = RemoveTrivialFilter().apply(plan)
        assert isinstance(rewritten, Limit) and rewritten.count == 0


class TestPredicatePushdown:
    def test_pushes_below_a_projection(self, source):
        plan = Filter(
            Project(Scan(source), (parse_expression("id"), parse_expression("amount"))),
            parse_expression("id > 1"),
        )
        rewritten = PredicatePushdown().apply(plan)
        assert isinstance(rewritten, Project)
        assert isinstance(rewritten.input, Filter)

    def test_rewrites_aliases_when_pushing(self, source):
        plan = Filter(
            Project(Scan(source), (aliased("amount * 2 AS doubled"),)),
            parse_expression("doubled > 10"),
        )
        rewritten = PredicatePushdown().apply(plan)
        pushed = find(rewritten, Filter)[0]
        assert pushed.predicate.to_sql() == "((amount * 2) > 10)"

    def test_does_not_push_through_an_aggregate_projection(self, source):
        aggregated = Aggregate(Scan(source), (parse_expression("region"),), (parse_expression("count(*)"),))
        plan = Filter(
            Project(aggregated, (parse_expression("region"),)), parse_expression("region = 'eu'")
        )
        rewritten = PredicatePushdown().apply(plan)
        assert isinstance(rewritten, Project)

    def test_pushes_below_a_sort(self, source):
        plan = Filter(
            Sort(Scan(source), (SortKey(parse_expression("id")),)), parse_expression("id > 1")
        )
        rewritten = PredicatePushdown().apply(plan)
        assert isinstance(rewritten, Sort) and isinstance(rewritten.input, Filter)

    def test_routes_each_side_of_a_join(self, source, customer_source):
        join = Join(
            Scan(source), Scan(customer_source), parse_expression("customer = customer_right"), "inner"
        )
        plan = Filter(join, parse_expression("amount > 10 AND tier = 'gold'"))
        rewritten = PredicatePushdown().apply(plan)
        node = rewritten if isinstance(rewritten, Join) else rewritten.input
        assert isinstance(node.left, Filter)
        assert isinstance(node.right, Filter)

    def test_keeps_cross_side_predicates_above_the_join(self, source, customer_source):
        join = Join(
            Scan(source), Scan(customer_source), parse_expression("customer = customer_right"), "inner"
        )
        plan = Filter(join, parse_expression("amount > 10 AND customer < tier"))
        rewritten = PredicatePushdown().apply(plan)
        assert isinstance(rewritten, Filter)

    def test_does_not_filter_the_null_extended_side_of_a_left_join(self, source, customer_source):
        join = Join(
            Scan(source), Scan(customer_source), parse_expression("customer = customer_right"), "left"
        )
        plan = Filter(join, parse_expression("tier = 'gold'"))
        rewritten = PredicatePushdown().apply(plan)
        assert isinstance(rewritten, Filter)
        assert not isinstance(rewritten.input.right, Filter)


class TestSetOperationPushdown:
    @pytest.mark.parametrize("node_type", [Intersect, Except])
    def test_a_predicate_stays_above_a_pairing_set_operation(self, source, node_type):
        plan = Filter(node_type(Scan(source), Scan(source)), parse_expression("id > 1"))
        rewritten = PredicatePushdown().apply(plan)
        assert isinstance(rewritten, Filter)
        assert isinstance(rewritten.input, node_type)

    @pytest.mark.parametrize("node_type", [Intersect, Except])
    def test_rewriting_keeps_the_operation_and_its_flag(self, source, node_type):
        plan = node_type(Scan(source), Scan(source), all=True)
        rewritten = optimize(plan)
        assert isinstance(rewritten, node_type) and rewritten.all is True


class TestProjectionPushdown:
    def test_narrows_the_scan_to_used_columns(self, source):
        plan = Project(Scan(source), (parse_expression("id"),))
        rewritten = ProjectionPushdown().apply(plan)
        assert find(rewritten, Scan)[0].projection == ("id",)

    def test_keeps_columns_a_filter_needs(self, source):
        plan = Project(
            Filter(Scan(source), parse_expression("amount > 1")), (parse_expression("id"),)
        )
        rewritten = ProjectionPushdown().apply(plan)
        assert set(find(rewritten, Scan)[0].projection) == {"id", "amount"}

    def test_keeps_columns_a_sort_needs(self, source):
        plan = Project(
            Sort(Scan(source), (SortKey(parse_expression("region")),)), (parse_expression("id"),)
        )
        rewritten = ProjectionPushdown().apply(plan)
        assert set(find(rewritten, Scan)[0].projection) == {"id", "region"}

    def test_keeps_every_column_below_a_distinct(self, source):
        plan = Distinct(Scan(source))
        rewritten = ProjectionPushdown().apply(plan)
        assert find(rewritten, Scan)[0].projection is None

    @pytest.mark.parametrize("node_type", [Intersect, Except])
    def test_keeps_every_column_below_a_pairing_set_operation(self, source, node_type):
        plan = node_type(Scan(source), Scan(source))
        rewritten = ProjectionPushdown().apply(plan)
        assert all(node.projection is None for node in find(rewritten, Scan))

    @pytest.mark.parametrize("node_type", [Intersect, Except])
    def test_prunes_below_a_pairing_set_operation(self, source, node_type):
        plan = node_type(
            Project(Scan(source), (parse_expression("id"),)),
            Project(Scan(source), (parse_expression("id"),)),
        )
        rewritten = ProjectionPushdown().apply(plan)
        assert all(node.projection == ("id",) for node in find(rewritten, Scan))

    def test_an_aggregate_only_needs_its_inputs(self, source):
        plan = Aggregate(Scan(source), (parse_expression("region"),), (parse_expression("sum(amount)"),))
        rewritten = ProjectionPushdown().apply(plan)
        assert set(find(rewritten, Scan)[0].projection) == {"region", "amount"}

    def test_always_keeps_at_least_one_column(self, source):
        plan = Aggregate(Scan(source), (), (parse_expression("count(*)"),))
        rewritten = ProjectionPushdown().apply(plan)
        assert len(find(rewritten, Scan)[0].projection) == 1


class TestCombineRules:
    def test_projections_collapse_when_cheap(self, source):
        inner = Project(Scan(source), (aliased("id AS key"), parse_expression("amount")))
        plan = Project(inner, (parse_expression("key"),))
        rewritten = CombineProjections().apply(plan)
        assert len(find(rewritten, Project)) == 1
        assert rewritten.schema.names == ["key"]

    def test_projections_do_not_collapse_when_work_would_be_duplicated(self, source):
        inner = Project(Scan(source), (aliased("amount * 2 AS doubled"),))
        plan = Project(inner, (parse_expression("doubled + doubled"),))
        assert len(find(CombineProjections().apply(plan), Project)) == 2

    def test_nested_limits_take_the_tighter_bound(self, source):
        plan = Limit(Limit(Scan(source), 10), 3)
        assert CombineLimits().apply(plan).count == 3

    def test_nested_limits_add_offsets(self, source):
        plan = Limit(Limit(Scan(source), 10, 2), 3, 4)
        rewritten = CombineLimits().apply(plan)
        assert (rewritten.count, rewritten.offset) == (3, 6)

    def test_an_inner_limit_bounds_the_outer_one(self, source):
        plan = Limit(Limit(Scan(source), 5), None, 3)
        assert CombineLimits().apply(plan).count == 2

    def test_distinct_over_distinct_collapses(self, source):
        assert isinstance(
            EliminateRedundantDistinct().apply(Distinct(Distinct(Scan(source)))), Distinct
        )

    def test_distinct_over_a_grouping_is_redundant(self, source):
        plan = Distinct(Aggregate(Scan(source), (parse_expression("region"),), ()))
        assert isinstance(EliminateRedundantDistinct().apply(plan), Aggregate)


class TestOptimizer:
    def test_reports_which_rules_fired(self, source):
        plan = Filter(Scan(source), parse_expression("amount > 2 * 5"))
        optimizer = default_optimizer()
        optimizer.optimize(plan)
        assert "ConstantFolding" in optimizer.last_report.applied

    def test_a_settled_plan_needs_no_rules(self, source):
        optimizer = default_optimizer()
        optimizer.optimize(optimizer.optimize(Scan(source)))
        assert optimizer.last_report.changed is False
        assert optimizer.last_report.converged

    def test_optimization_preserves_the_output_schema(self, source):
        plan = (
            PlanBuilder.from_source(source)
            .filter("amount > 1")
            .project(["id", "region"])
            .sort("id DESC")
            .limit(3)
            .build()
        )
        assert optimize(plan).schema == plan.schema

    def test_a_rule_that_changes_the_schema_is_rejected(self, source):
        class Broken(Rule):
            name = "Broken"

            def apply(self, plan: LogicalPlan) -> LogicalPlan:
                return Project(plan, (Alias(parse_expression("region"), "renamed"),))

        with pytest.raises(PlanningError):
            Optimizer([Broken()]).optimize(Project(Scan(source), (parse_expression("region"),)))

    def test_rules_can_be_added_and_removed(self):
        optimizer = default_optimizer()
        assert "ConstantFolding" in optimizer.without_rule("Nothing").rule_names()
        assert "ConstantFolding" not in optimizer.without_rule("ConstantFolding").rule_names()

    def test_the_iteration_budget_is_respected(self, source):
        class Flapping(Rule):
            name = "Flapping"

            def __init__(self):
                self.calls = 0

            def apply(self, plan: LogicalPlan) -> LogicalPlan:
                self.calls += 1
                return Limit(plan, 5) if not isinstance(plan, Limit) else plan.input

        rule = Flapping()
        Optimizer([rule], max_iterations=3).optimize(Scan(source))
        assert rule.calls == 3

    def test_a_zero_iteration_budget_is_rejected(self):
        with pytest.raises(ValueError):
            Optimizer(max_iterations=0)

    def test_the_report_describes_itself(self, source):
        optimizer = default_optimizer()
        optimizer.optimize(Filter(Scan(source), parse_expression("amount > 1 AND true")))
        assert "iteration" in optimizer.last_report.describe()
