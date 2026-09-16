"""Tests for logical plan nodes, the builder, printing and statistics."""

from __future__ import annotations

import pytest

from veldt.errors import PlanningError
from veldt.expr.parser import parse_expression
from veldt.plan.builder import PlanBuilder, parse_sort_key
from veldt.plan.logical import (
    Aggregate,
    Distinct,
    Except,
    Filter,
    Intersect,
    Join,
    Limit,
    Project,
    Scan,
    Sort,
    SortKey,
    Union,
)
from veldt.plan.printer import format_plan, format_plan_tree, format_schema, plan_summary
from veldt.plan.stats import Statistics, estimate, selectivity
from veldt.storage.memory import MemorySource
from veldt.types.dtypes import DataType


@pytest.fixture
def orders_source(orders):
    return MemorySource("orders", orders)


@pytest.fixture
def customers_source(customers):
    return MemorySource("customers", customers)


@pytest.fixture
def scan(orders_source):
    return Scan(orders_source, "orders")


class TestPlanNodes:
    def test_scan_schema_follows_its_projection(self, scan):
        assert scan.with_projection(["id", "amount"]).schema.names == ["id", "amount"]

    def test_filter_preserves_the_schema(self, scan):
        node = Filter(scan, parse_expression("amount > 1"))
        assert node.schema == scan.schema

    def test_filter_rejects_aggregates(self, scan):
        with pytest.raises(PlanningError):
            Filter(scan, parse_expression("sum(amount) > 1"))

    def test_project_computes_its_output_schema(self, scan):
        node = Project(scan, (parse_expression("id"), parse_expression("amount + 1")))
        assert node.schema.names == ["id", "(amount + 1)"]

    def test_project_rejects_an_empty_list(self, scan):
        with pytest.raises(PlanningError):
            Project(scan, ())

    def test_project_rejects_aggregates(self, scan):
        with pytest.raises(PlanningError):
            Project(scan, (parse_expression("sum(amount)"),))

    def test_identity_projection_is_detected(self, scan):
        identity = Project(scan, tuple(parse_expression(name) for name in scan.schema.names))
        assert identity.is_identity()

    def test_aggregate_schema_is_groups_then_aggregates(self, scan):
        node = Aggregate(scan, (parse_expression("region"),), (parse_expression("count(*)"),))
        assert node.schema.names == ["region", "count(*)"]

    def test_aggregate_needs_something_to_compute(self, scan):
        with pytest.raises(PlanningError):
            Aggregate(scan, (), ())

    def test_aggregate_rejects_aggregates_in_group_keys(self, scan):
        with pytest.raises(PlanningError):
            Aggregate(scan, (parse_expression("sum(amount)"),), ())

    def test_global_aggregate_is_flagged(self, scan):
        node = Aggregate(scan, (), (parse_expression("count(*)"),))
        assert node.is_global

    def test_sort_needs_a_key(self, scan):
        with pytest.raises(PlanningError):
            Sort(scan, ())

    def test_limit_rejects_negatives(self, scan):
        with pytest.raises(PlanningError):
            Limit(scan, -1)
        with pytest.raises(PlanningError):
            Limit(scan, 1, -1)

    def test_limit_fetch_includes_the_offset(self, scan):
        assert Limit(scan, 5, 3).fetch == 8
        assert Limit(scan, None, 3).fetch is None

    def test_join_rejects_an_unknown_type(self, scan):
        with pytest.raises(PlanningError):
            Join(scan, scan, parse_expression("1 = 1"), "sideways")

    def test_cross_join_must_not_have_a_condition(self, scan):
        with pytest.raises(PlanningError):
            Join(scan, scan, parse_expression("1 = 1"), "cross")

    def test_inner_join_requires_a_condition(self, scan):
        with pytest.raises(PlanningError):
            Join(scan, scan, None, "inner")

    def test_join_schema_disambiguates_duplicate_names(self, orders_source, customers_source):
        node = Join(
            Scan(orders_source),
            Scan(customers_source),
            parse_expression("customer = customer"),
            "inner",
        )
        assert "customer_right" in node.schema.names

    def test_union_unifies_the_two_schemas(self, scan):
        node = Union(scan, scan, all=True)
        assert node.schema.names == scan.schema.names

    def test_the_pairing_operators_publish_what_a_union_does(self, scan):
        for node in (Intersect(scan, scan), Except(scan, scan)):
            assert node.schema == Union(scan, scan).schema

    def test_they_describe_their_spelling(self, scan):
        assert Intersect(scan, scan).describe() == "Intersect: distinct"
        assert Except(scan, scan, all=True).describe() == "Except: all"
        assert Union(scan, scan, all=True).describe() == "Union: all"

    def test_rebuilding_keeps_the_kind_and_the_flag(self, scan):
        node = Except(scan, scan, all=True)
        rebuilt = node.with_children([scan, scan])
        assert isinstance(rebuilt, Except) and rebuilt.all is True

    def test_rebuilding_rejects_the_wrong_arity(self, scan):
        with pytest.raises(ValueError):
            Intersect(scan, scan).with_children([scan])

    def test_the_kinds_are_not_equal_to_each_other(self, scan):
        assert Intersect(scan, scan) != Except(scan, scan)
        assert Union(scan, scan) != Intersect(scan, scan)


class TestJoinKeys:
    def test_equality_between_the_sides_becomes_a_key(self, orders_source, customers_source):
        node = Join(
            Scan(orders_source),
            Scan(customers_source),
            parse_expression("customer = tier"),
            "inner",
        )
        keys = node.equi_keys()
        assert len(keys) == 1
        assert keys[0][0].to_sql() == "customer"

    def test_conditions_on_one_side_are_not_keys(self, orders_source, customers_source):
        node = Join(
            Scan(orders_source),
            Scan(customers_source),
            parse_expression("amount = id"),
            "inner",
        )
        assert node.equi_keys() == []

    def test_non_equality_conditions_become_residual(self, orders_source, customers_source):
        node = Join(
            Scan(orders_source),
            Scan(customers_source),
            parse_expression("customer = tier AND amount > 10"),
            "inner",
        )
        assert len(node.equi_keys()) == 1
        assert node.residual_condition().to_sql() == "(amount > 10)"

    def test_a_pure_equi_join_has_no_residual(self, orders_source, customers_source):
        node = Join(
            Scan(orders_source),
            Scan(customers_source),
            parse_expression("customer = tier"),
            "inner",
        )
        assert node.residual_condition() is None


class TestPlanBuilder:
    def test_builds_a_pipeline(self, orders_source):
        plan = (
            PlanBuilder.from_source(orders_source)
            .filter("amount > 10")
            .aggregate(["region"], ["sum(amount) AS total"])
            .sort("total DESC")
            .limit(3)
            .build()
        )
        assert isinstance(plan, Limit)
        assert plan.schema.names == ["region", "total"]

    def test_validates_columns_as_it_goes(self, orders_source):
        with pytest.raises(Exception):
            PlanBuilder.from_source(orders_source).filter("nope > 1")

    def test_rejects_aggregates_in_filters(self, orders_source):
        with pytest.raises(PlanningError):
            PlanBuilder.from_source(orders_source).filter("sum(amount) > 1")

    def test_select_projects_named_columns(self, orders_source):
        plan = PlanBuilder.from_source(orders_source).select("id", "region").build()
        assert plan.schema.names == ["id", "region"]

    def test_distinct_and_union_compose(self, orders_source):
        left = PlanBuilder.from_source(orders_source).select("region")
        plan = left.union(left.build(), all_rows=True).distinct().build()
        assert isinstance(plan, Distinct)

    def test_intersect_and_except_build_their_nodes(self, orders_source):
        left = PlanBuilder.from_source(orders_source).select("region")
        assert isinstance(left.intersect(left.build()).build(), Intersect)
        assert isinstance(left.except_(left.build(), all_rows=True).build(), Except)

    def test_sort_requires_a_key(self, orders_source):
        with pytest.raises(PlanningError):
            PlanBuilder.from_source(orders_source).sort()

    def test_join_builds_a_join_node(self, orders_source, customers_source):
        plan = (
            PlanBuilder.from_source(orders_source)
            .join(PlanBuilder.from_source(customers_source), "customer = customer_right", "left")
            .build()
        )
        assert isinstance(plan, Join) and plan.how == "left"


class TestSortKeys:
    def test_defaults_to_ascending(self):
        assert parse_sort_key("a").ascending

    def test_parses_direction_and_null_placement(self):
        key = parse_sort_key("a DESC NULLS FIRST")
        assert key.ascending is False
        assert key.nulls_first is True

    def test_nulls_sort_first_ascending_by_default(self):
        assert parse_sort_key("a").nulls_first_effective is True

    def test_nulls_sort_last_descending_by_default(self):
        assert parse_sort_key("a DESC").nulls_first_effective is False

    def test_rejects_a_dangling_nulls_keyword(self):
        with pytest.raises(PlanningError):
            parse_sort_key("a NULLS")

    def test_rejects_trailing_text(self):
        with pytest.raises(PlanningError):
            parse_sort_key("a DESC extra")


class TestPrinting:
    def test_indents_by_depth(self, orders_source):
        plan = PlanBuilder.from_source(orders_source).filter("amount > 1").limit(2).build()
        rendered = format_plan(plan)
        assert rendered.splitlines()[0].startswith("Limit")
        assert rendered.splitlines()[1].startswith("  Filter")

    def test_can_annotate_schemas(self, orders_source):
        rendered = format_plan(Scan(orders_source), show_schema=True)
        assert "id:int64" in rendered

    def test_tree_form_uses_connectors(self, orders_source):
        plan = PlanBuilder.from_source(orders_source).filter("amount > 1").build()
        assert "`--" in format_plan_tree(plan)

    def test_summary_counts_node_kinds(self, orders_source):
        plan = (
            PlanBuilder.from_source(orders_source)
            .filter("amount > 1")
            .filter("id > 0")
            .build()
        )
        assert "Filterx2" in plan_summary(plan)

    def test_schema_format_is_compact(self, order_schema):
        assert format_schema(order_schema).startswith("(id:int64")


class TestStatistics:
    def test_memory_sources_report_exact_counts(self, orders_source):
        assert estimate(Scan(orders_source)).num_rows == 6

    def test_filters_shrink_the_estimate(self, orders_source):
        plan = Filter(Scan(orders_source), parse_expression("region = 'eu'"))
        assert estimate(plan).num_rows < 6

    def test_global_aggregates_produce_one_row(self, orders_source):
        plan = Aggregate(Scan(orders_source), (), (parse_expression("count(*)"),))
        assert estimate(plan).num_rows == 1

    def test_limits_cap_the_estimate(self, orders_source):
        assert estimate(Limit(Scan(orders_source), 2)).num_rows == 2

    def test_offsets_reduce_the_remainder(self, orders_source):
        assert estimate(Limit(Scan(orders_source), None, 4)).num_rows == 2

    def test_cross_joins_multiply(self, orders_source, customers_source):
        plan = Join(Scan(orders_source), Scan(customers_source), None, "cross")
        assert estimate(plan).num_rows == 18

    def test_union_all_adds(self, orders_source):
        plan = Union(Scan(orders_source), Scan(orders_source), all=True)
        assert estimate(plan).num_rows == 12

    def test_neither_pairing_operator_beats_its_left_input(self, orders_source):
        scan = Scan(orders_source)
        for node in (Intersect(scan, scan, all=True), Except(scan, scan, all=True)):
            assert estimate(node).num_rows == estimate(scan).num_rows

    def test_an_intersection_is_capped_by_its_right_input(self, orders_source):
        scan = Scan(orders_source)
        small = Limit(scan, 2)
        assert estimate(Intersect(scan, small, all=True)).num_rows == 2
        assert estimate(Except(scan, small, all=True)).num_rows == 6

    def test_the_plain_spelling_is_scaled_like_a_union(self, orders_source):
        scan = Scan(orders_source)
        assert estimate(Intersect(scan, scan)).num_rows == 4
        assert estimate(Except(scan, scan)).num_rows == 4

    def test_the_plain_spelling_may_estimate_nothing(self, orders_source):
        empty = Limit(Scan(orders_source), 0)
        assert estimate(Except(empty, empty)).num_rows == 0


    def test_selectivity_of_a_constant_predicate(self):
        assert selectivity(parse_expression("true")) == 1.0
        assert selectivity(parse_expression("false")) == 0.0

    def test_equality_is_more_selective_than_a_range(self):
        assert selectivity(parse_expression("a = 1")) < selectivity(parse_expression("a > 1"))

    def test_unknown_row_counts_propagate(self):
        assert Statistics(None).scaled(0.5).num_rows is None
