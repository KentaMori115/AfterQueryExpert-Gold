"""Tests for plan expressions, plan nodes, and traversal helpers."""

from __future__ import annotations

import pytest

from slateql.errors import PlanningError
from slateql.plan import expressions as X
from slateql.plan.logical import (
    Aggregate,
    Filter,
    Join,
    Limit,
    NamedExpr,
    OneRow,
    Project,
    Scan,
    Sort,
    SortItem,
)
from slateql.plan.printer import format_plan, format_tree
from slateql.plan.visitor import (
    collect,
    count_nodes,
    map_expressions,
    plan_depth,
    same_plan,
    transform_down,
    transform_up,
)
from slateql.sql.ast_nodes import JoinKind
from slateql.types.datatypes import BOOLEAN, INTEGER, STRING
from slateql.types.schema import Schema

TABLE = Schema.of(("id", INTEGER), ("name", STRING))


def scan(alias="t") -> Scan:
    return Scan(table="t", alias=alias, table_schema=TABLE)


def column(name, dtype=INTEGER, qualifier="t") -> X.Column:
    return X.Column(name=name, dtype=dtype, qualifier=qualifier)


def test_expression_equality_is_structural():
    assert column("id") == column("id")
    assert hash(column("id")) == hash(column("id"))


def test_columns_of_finds_every_reference():
    expression = X.BinaryExpr(
        op="AND",
        left=X.BinaryExpr(
            op="=", left=column("id"), right=X.Literal(1, INTEGER), dtype=BOOLEAN
        ),
        right=X.IsNull(operand=column("name", STRING)),
        dtype=BOOLEAN,
    )
    assert {c.name for c in X.columns_of(expression)} == {"id", "name"}


def test_conjuncts_splits_only_top_level_ands():
    expression = X.combine_and(
        [column("id"), column("name", STRING), column("id")]
    )
    assert len(X.conjuncts(expression)) == 3


def test_combine_and_of_nothing_is_none():
    assert X.combine_and([]) is None


def test_transform_rebuilds_only_changed_nodes():
    expression = X.BinaryExpr(
        op="+", left=column("id"), right=X.Literal(1, INTEGER), dtype=INTEGER
    )
    unchanged = expression.transform(lambda node: node)
    assert unchanged is expression


def test_replace_columns_substitutes_by_name():
    expression = X.BinaryExpr(
        op="+", left=column("id"), right=X.Literal(1, INTEGER), dtype=INTEGER
    )
    replaced = X.replace_columns(expression, {"t.id": X.Literal(9, INTEGER)})
    assert replaced.left == X.Literal(9, INTEGER)


def test_literal_is_constant_and_columns_are_not():
    assert X.Literal(1, INTEGER).is_constant
    assert not column("id").is_constant


def test_volatile_functions_propagate_upwards():
    call = X.ScalarFunction(name="now", args=(), dtype=INTEGER, volatile=True)
    wrapper = X.CastExpr(operand=call, dtype=STRING)
    assert wrapper.is_volatile


def test_aggregate_output_names_are_stable():
    call = X.AggregateCall(name="count", args=(), dtype=INTEGER, star=True)
    assert call.output_name() == "count(*)"
    distinct = X.AggregateCall(
        name="sum", args=(column("id"),), dtype=INTEGER, distinct=True
    )
    assert distinct.output_name() == "sum(distinct t.id)"


def test_expression_sql_round_trips_through_str():
    expression = X.BinaryExpr(
        op="=", left=column("id"), right=X.Literal(1, INTEGER), dtype=BOOLEAN
    )
    assert str(expression) == "(t.id = 1)"


def test_scan_schema_is_qualified():
    assert scan().schema.qualified_names == ["t.id", "t.name"]


def test_scan_projection_narrows_the_schema():
    assert scan().with_projection([1]).schema.names == ["name"]


def test_project_detects_identity():
    projections = tuple(
        NamedExpr(expression=column(f.name, f.dtype), name=f.name)
        for f in scan().schema
    )
    assert Project(input=scan(), projections=projections).is_identity


def test_project_with_a_rename_is_not_identity():
    projections = (NamedExpr(expression=column("id"), name="other"),)
    assert not Project(input=scan(), projections=projections).is_identity


def test_aggregate_rejects_non_aggregate_outputs():
    with pytest.raises(PlanningError):
        Aggregate(
            input=scan(),
            aggregates=(NamedExpr(expression=column("id"), name="x"),),
        )


def test_limit_rejects_negative_values():
    with pytest.raises(PlanningError):
        Limit(input=scan(), count=-1)
    with pytest.raises(PlanningError):
        Limit(input=scan(), offset=-1)


def test_limit_fetch_total_adds_the_offset():
    assert Limit(input=scan(), count=5, offset=2).fetch_total == 7
    assert Limit(input=scan(), offset=2).fetch_total is None


def test_cross_join_rejects_a_condition():
    with pytest.raises(PlanningError):
        Join(
            kind=JoinKind.CROSS,
            left=scan("a"),
            right=scan("b"),
            condition=X.TRUE,
        )


def test_outer_join_widens_nullability():
    join = Join(kind=JoinKind.LEFT, left=scan("a"), right=scan("b"))
    assert all(field.dtype.nullable for field in join.schema.fields[2:])


def test_transform_up_visits_children_first():
    seen: list[str] = []

    def rule(node):
        seen.append(type(node).__name__)
        return node

    transform_up(Filter(input=scan(), predicate=X.TRUE), rule)
    assert seen == ["Scan", "Filter"]


def test_transform_down_visits_parents_first():
    seen: list[str] = []

    def rule(node):
        seen.append(type(node).__name__)
        return node

    transform_down(Filter(input=scan(), predicate=X.TRUE), rule)
    assert seen == ["Filter", "Scan"]


def test_map_expressions_rewrites_only_the_node():
    plan = Filter(input=scan(), predicate=X.TRUE)
    rewritten = map_expressions(plan, lambda e: X.FALSE)
    assert rewritten.predicate == X.FALSE
    assert rewritten.input is plan.input


def test_map_expressions_touches_sort_keys():
    plan = Sort(input=scan(), keys=(SortItem(expression=column("id")),))
    rewritten = map_expressions(plan, lambda e: X.Literal(1, INTEGER))
    assert rewritten.keys[0].expression == X.Literal(1, INTEGER)


def test_count_nodes_and_depth():
    plan = Filter(input=Filter(input=scan(), predicate=X.TRUE), predicate=X.TRUE)
    assert count_nodes(plan) == 3
    assert plan_depth(plan) == 3


def test_collect_finds_matching_nodes():
    plan = Filter(input=scan(), predicate=X.TRUE)
    assert len(collect(plan, lambda node: isinstance(node, Scan))) == 1


def test_same_plan_compares_structurally():
    assert same_plan(scan(), scan())
    assert not same_plan(scan("a"), scan("b"))


def test_format_plan_indents_children():
    plan = Filter(input=scan(), predicate=X.TRUE)
    lines = format_plan(plan).splitlines()
    assert lines[0].startswith("Filter")
    assert lines[1].startswith("`- Scan")


def test_format_plan_annotations():
    plan = Filter(input=scan(), predicate=X.TRUE)
    text = format_plan(plan, annotate=lambda node: "#" + node.node_name)
    assert "#Filter" in text


def test_format_tree_is_generic():
    tree = ("a", [("b", []), ("c", [])])
    text = format_tree(tree, lambda node: node[1], lambda node: node[0])
    assert text.splitlines() == ["a", "|- b", "`- c"]


def test_one_row_has_an_empty_schema():
    assert len(OneRow().schema) == 0
