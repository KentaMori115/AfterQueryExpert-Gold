"""Tests for the optimizer rules and their pipeline."""

from __future__ import annotations

import pytest

from slateql.config import SessionConfig
from slateql.optimize.pipeline import OptimizationTrace, Optimizer
from slateql.optimize.rule import RuleContext
from slateql.optimize.rules import (
    ConstantFolding,
    LimitPushdown,
    PredicatePushdown,
    ProjectionPruning,
    RemoveRedundantOperators,
    SimplifyExpressions,
    merge_limits,
    simplify,
)
from slateql.optimize.stats import estimate_cardinality, estimate_selectivity
from slateql.plan import expressions as X
from slateql.plan.logical import (
    Distinct,
    EmptyRelation,
    Filter,
    Limit,
    LogicalPlan,
    Project,
    Scan,
    Sort,
)
from slateql.plan.printer import format_plan
from slateql.types.datatypes import BOOLEAN, INTEGER


def optimized(session, statement) -> LogicalPlan:
    return session.plan(statement)


def nodes(plan, kind):
    return [node for node in plan.walk() if isinstance(node, kind)]


def test_constant_arithmetic_is_folded(session):
    plan = optimized(session, "SELECT id FROM customers WHERE id > 1 + 1")
    scan = nodes(plan, Scan)[0]
    assert scan.pushed_filters[0].right == X.Literal(value=2, dtype=INTEGER.as_nullable(False))


def test_volatile_functions_are_not_folded(session):
    expression = X.ScalarFunction(
        name="now", args=(), dtype=INTEGER, volatile=True
    )
    from slateql.optimize.rules.constant_fold import fold_expression

    assert fold_expression(expression) is expression


def test_folding_leaves_failing_expressions_alone():
    from slateql.optimize.rules.constant_fold import fold_expression

    expression = X.BinaryExpr(
        op="/",
        left=X.Literal(1, INTEGER),
        right=X.Literal(0, INTEGER),
        dtype=INTEGER,
    )
    assert isinstance(fold_expression(expression), X.BinaryExpr)


def test_double_negation_is_removed():
    inner = X.Column("a", BOOLEAN)
    expression = X.UnaryExpr(
        op="NOT",
        operand=X.UnaryExpr(op="NOT", operand=inner, dtype=BOOLEAN),
        dtype=BOOLEAN,
    )
    assert simplify(expression) is inner


def test_not_of_a_comparison_flips_the_operator():
    expression = X.UnaryExpr(
        op="NOT",
        operand=X.BinaryExpr(
            op="<",
            left=X.Column("a", INTEGER),
            right=X.Literal(1, INTEGER),
            dtype=BOOLEAN,
        ),
        dtype=BOOLEAN,
    )
    assert simplify(expression).op == ">="


def test_and_with_true_collapses():
    column = X.Column("a", BOOLEAN)
    expression = X.BinaryExpr(op="AND", left=column, right=X.TRUE, dtype=BOOLEAN)
    assert simplify(expression) is column


def test_or_with_true_is_true():
    expression = X.BinaryExpr(
        op="OR", left=X.Column("a", BOOLEAN), right=X.TRUE, dtype=BOOLEAN
    )
    assert simplify(expression) == X.TRUE


def test_single_element_in_list_becomes_equality():
    expression = X.InList(
        operand=X.Column("a", INTEGER), items=(X.Literal(1, INTEGER),)
    )
    simplified = simplify(expression)
    assert isinstance(simplified, X.BinaryExpr) and simplified.op == "="


def test_always_false_filter_becomes_an_empty_relation(session):
    plan = optimized(session, "SELECT id FROM customers WHERE 1 = 2")
    assert nodes(plan, EmptyRelation)


def test_always_true_filter_is_removed(session):
    plan = optimized(session, "SELECT id FROM customers WHERE 1 = 1")
    assert not nodes(plan, Filter)


def test_predicate_is_pushed_into_the_scan(session):
    plan = optimized(session, "SELECT id FROM customers WHERE city = 'Oslo'")
    assert nodes(plan, Scan)[0].pushed_filters
    assert not nodes(plan, Filter)


def test_predicate_is_pushed_through_a_sort(session):
    plan = optimized(
        session, "SELECT id FROM customers WHERE id > 2 ORDER BY name"
    )
    assert nodes(plan, Scan)[0].pushed_filters


def test_join_predicates_are_routed_to_each_side(session):
    plan = optimized(
        session,
        "SELECT c.id FROM customers c JOIN orders o ON o.customer_id = c.id "
        "WHERE c.city = 'Oslo' AND o.quantity > 1",
    )
    scans = {scan.alias: scan for scan in nodes(plan, Scan)}
    assert scans["c"].pushed_filters
    assert scans["o"].pushed_filters


def test_left_join_does_not_push_onto_the_padded_side(session):
    plan = optimized(
        session,
        "SELECT c.id FROM customers c LEFT JOIN orders o ON o.customer_id = c.id "
        "WHERE o.quantity > 1",
    )
    scans = {scan.alias: scan for scan in nodes(plan, Scan)}
    assert not scans["o"].pushed_filters
    assert nodes(plan, Filter)


def test_predicate_on_a_group_key_is_pushed_below_the_aggregate(session):
    plan = optimized(
        session,
        "SELECT city, COUNT(*) AS n FROM customers GROUP BY city HAVING city = 'Oslo'",
    )
    assert nodes(plan, Scan)[0].pushed_filters


def test_predicate_on_an_aggregate_stays_above_it(session):
    plan = optimized(
        session,
        "SELECT city, COUNT(*) AS n FROM customers GROUP BY city HAVING COUNT(*) > 1",
    )
    assert nodes(plan, Filter)
    assert not nodes(plan, Scan)[0].pushed_filters


def test_scan_projects_only_referenced_columns(session):
    plan = optimized(session, "SELECT name FROM customers WHERE city = 'Oslo'")
    scan = nodes(plan, Scan)[0]
    assert sorted(scan.schema.names) == ["city", "name"]


def test_pruning_keeps_the_root_output(session):
    plan = optimized(session, "SELECT * FROM customers")
    assert len(plan.schema) == 5


def test_pruning_keeps_distinct_inputs(session):
    plan = optimized(session, "SELECT DISTINCT city, active FROM customers")
    assert len(plan.schema) == 2
    assert nodes(plan, Distinct)


def test_limit_is_pushed_below_a_projection(session):
    plan = optimized(session, "SELECT id + 1 AS x FROM customers LIMIT 2")
    order = [type(node).__name__ for node in plan.walk()]
    assert order.index("Project") < order.index("Limit")


def test_zero_limit_becomes_an_empty_relation(session):
    plan = optimized(session, "SELECT id FROM customers LIMIT 0")
    assert nodes(plan, EmptyRelation)


def test_merge_limits_combines_counts_and_offsets():
    from slateql.plan.logical import OneRow

    inner = Limit(input=OneRow(), count=10, offset=5)
    outer = Limit(input=inner, count=3, offset=2)
    merged = merge_limits(outer, inner)
    assert (merged.count, merged.offset) == (3, 7)


def test_merge_limits_respects_the_inner_bound():
    from slateql.plan.logical import OneRow

    inner = Limit(input=OneRow(), count=4, offset=0)
    outer = Limit(input=inner, count=10, offset=1)
    merged = merge_limits(outer, inner)
    assert merged.count == 3


def test_nested_sorts_collapse(session):
    plan = optimized(session, "SELECT name FROM customers ORDER BY id")
    assert len(nodes(plan, Sort)) == 1


def test_identity_projection_is_removed(session):
    plan = optimized(session, "SELECT * FROM customers")
    assert not nodes(plan, Project)


def test_optimizer_reaches_a_fixed_point(session):
    trace = OptimizationTrace()
    optimizer = Optimizer(session.catalog, config=session.config)
    logical = session.logical_plan(
        "SELECT c.city, COUNT(*) AS n FROM customers c "
        "JOIN orders o ON o.customer_id = c.id WHERE c.city = 'Oslo' "
        "GROUP BY c.city ORDER BY n DESC LIMIT 3"
    )
    optimizer.optimize(logical, trace=trace)
    assert trace.iterations < 8


def test_optimizer_is_idempotent(session):
    statement = "SELECT id FROM customers WHERE id > 1 ORDER BY name LIMIT 2"
    once = session.plan(statement)
    optimizer = Optimizer(session.catalog, config=session.config)
    twice = optimizer.optimize(once)
    assert format_plan(once) == format_plan(twice)


def test_disabling_the_optimizer_preserves_the_bound_plan(session):
    session.configure(optimize=False)
    statement = "SELECT id FROM customers WHERE 1 = 1"
    assert format_plan(session.plan(statement)) == format_plan(
        session.logical_plan(statement)
    )


def test_optimization_does_not_change_results(session):
    statements = [
        "SELECT city, COUNT(*) AS n FROM customers GROUP BY city ORDER BY city NULLS LAST",
        "SELECT c.id, o.order_id FROM customers c LEFT JOIN orders o "
        "ON o.customer_id = c.id ORDER BY c.id, o.order_id",
        "SELECT DISTINCT city FROM customers ORDER BY city NULLS LAST",
        "SELECT name FROM customers WHERE id > 2 ORDER BY id LIMIT 2",
    ]
    for statement in statements:
        optimized_rows = session.sql(statement).to_tuples()
        session.configure(optimize=False)
        plain_rows = session.sql(statement).to_tuples()
        session.configure(optimize=True)
        assert optimized_rows == plain_rows, statement


def test_selectivity_estimates_are_bounded():
    predicate = X.BinaryExpr(
        op="=", left=X.Column("a", INTEGER), right=X.Literal(1, INTEGER), dtype=BOOLEAN
    )
    assert 0.0 < estimate_selectivity(predicate) < 1.0
    assert estimate_selectivity(X.TRUE) == 1.0
    assert estimate_selectivity(X.FALSE) == 0.0


def test_cardinality_of_a_scan_uses_the_catalog(session):
    plan = session.logical_plan("SELECT id FROM customers")
    context = RuleContext(session.catalog)
    assert estimate_cardinality(plan, context) == 6


def test_cardinality_without_statistics_falls_back(session):
    plan = session.logical_plan("SELECT id FROM customers")
    context = RuleContext(session.catalog, use_statistics=False)
    assert estimate_cardinality(plan, context) > 0


def test_join_inputs_are_ordered_by_size(session):
    session.register_dicts("tiny", [{"j": 1}])
    session.register_dicts("big", [{"j": i} for i in range(200)])
    plan = optimized(session, "SELECT t.j FROM tiny t JOIN big b ON b.j = t.j")
    from slateql.plan.logical import Join

    join = next(node for node in plan.walk() if isinstance(node, Join))
    assert estimate_cardinality(join.right, RuleContext(session.catalog)) <= (
        estimate_cardinality(join.left, RuleContext(session.catalog))
    )


def test_outer_joins_are_never_reordered(session):
    plan = optimized(
        session,
        "SELECT c.id FROM customers c LEFT JOIN orders o ON o.customer_id = c.id",
    )
    from slateql.plan.logical import Join

    join = next(node for node in plan.walk() if isinstance(node, Join))
    assert {scan.alias for scan in nodes(join.left, Scan)} == {"c"}


def test_rules_report_their_names():
    for rule in (
        ConstantFolding(),
        SimplifyExpressions(),
        RemoveRedundantOperators(),
        PredicatePushdown(),
        LimitPushdown(),
        ProjectionPruning(),
    ):
        assert rule.name and "-" in rule.name


def test_configuration_rejects_unknown_options():
    from slateql.errors import ConfigurationError

    with pytest.raises(ConfigurationError):
        SessionConfig().replace(nonsense=1)
