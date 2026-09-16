"""Tests for join semantics and join algorithm selection."""

from __future__ import annotations

import pytest

from slateql.execution.operators import HashJoinOperator, NestedLoopJoinOperator
from slateql.execution.planner import PhysicalPlanner, extract_equi_keys
from slateql.plan import expressions as X
from slateql.types.datatypes import INTEGER
from slateql.types.schema import Schema


def operators(session, statement):
    plan = session.plan(statement)
    root = PhysicalPlanner(session.catalog).build(plan)
    return list(root.walk())


def test_inner_join_drops_unmatched_rows(session):
    result = session.sql(
        "SELECT c.id, o.order_id FROM customers c "
        "JOIN orders o ON o.customer_id = c.id ORDER BY o.order_id"
    )
    assert result.column("order_id") == [100, 101, 102, 103, 104, 105, 106]


def test_left_join_pads_unmatched_left_rows(session):
    result = session.sql(
        "SELECT c.id, o.order_id FROM customers c "
        "LEFT JOIN orders o ON o.customer_id = c.id "
        "WHERE c.id = 6"
    )
    assert result.to_tuples() == [(6, None)]


def test_right_join_pads_unmatched_right_rows(session):
    result = session.sql(
        "SELECT c.id, o.order_id FROM customers c "
        "RIGHT JOIN orders o ON o.customer_id = c.id "
        "WHERE c.id IS NULL"
    )
    assert result.to_tuples() == [(None, 107)]


def test_full_join_pads_both_sides(session):
    result = session.sql(
        "SELECT c.id, o.order_id FROM customers c "
        "FULL JOIN orders o ON o.customer_id = c.id"
    )
    left_only = [row for row in result.rows if row[1] is None]
    right_only = [row for row in result.rows if row[0] is None]
    assert len(left_only) == 1
    assert len(right_only) == 1


def test_cross_join_multiplies_row_counts(session):
    result = session.sql(
        "SELECT c.id, o.order_id FROM customers c CROSS JOIN orders o"
    )
    assert len(result) == 6 * 8


def test_null_keys_never_match(session):
    session.register_dicts("left_side", [{"k": None, "v": 1}])
    session.register_dicts("right_side", [{"k": None, "w": 2}])
    result = session.sql(
        "SELECT l.v, r.w FROM left_side l JOIN right_side r ON l.k = r.k"
    )
    assert result.is_empty


def test_null_keys_still_reach_the_outer_padding(session):
    session.register_dicts("left_side", [{"k": None, "v": 1}, {"k": 7, "v": 2}])
    session.register_dicts("right_side", [{"k": 7, "w": 9}])
    result = session.sql(
        "SELECT l.v, r.w FROM left_side l LEFT JOIN right_side r ON l.k = r.k "
        "ORDER BY l.v"
    )
    assert result.to_tuples() == [(1, None), (2, 9)]


def test_join_condition_with_a_residual_predicate(session):
    result = session.sql(
        "SELECT c.id, o.order_id FROM customers c "
        "JOIN orders o ON o.customer_id = c.id AND o.quantity > 1 "
        "ORDER BY o.order_id"
    )
    assert result.column("order_id") == [100, 104, 105, 106]


def test_outer_join_residual_predicate_pads_instead_of_dropping(session):
    result = session.sql(
        "SELECT c.id, o.order_id FROM customers c "
        "LEFT JOIN orders o ON o.customer_id = c.id AND o.quantity > 100 "
        "WHERE c.id = 1"
    )
    assert result.to_tuples() == [(1, None)]


def test_three_way_join(session):
    result = session.sql(
        "SELECT c.id FROM customers c "
        "JOIN orders o ON o.customer_id = c.id "
        "JOIN orders o2 ON o2.customer_id = c.id "
        "WHERE c.id = 1"
    )
    assert len(result) == 4


def test_equi_join_uses_a_hash_join(session):
    kinds = operators(
        session,
        "SELECT c.id FROM customers c JOIN orders o ON o.customer_id = c.id",
    )
    assert any(isinstance(node, HashJoinOperator) for node in kinds)


def test_inequality_join_falls_back_to_nested_loops(session):
    kinds = operators(
        session,
        "SELECT c.id FROM customers c JOIN orders o ON o.customer_id > c.id",
    )
    assert any(isinstance(node, NestedLoopJoinOperator) for node in kinds)


def test_cross_join_uses_nested_loops(session):
    kinds = operators(session, "SELECT c.id FROM customers c CROSS JOIN orders o")
    assert any(isinstance(node, NestedLoopJoinOperator) for node in kinds)


def test_both_algorithms_agree(session):
    statement = (
        "SELECT c.id, o.order_id FROM customers c "
        "LEFT JOIN orders o ON o.customer_id = c.id ORDER BY c.id, o.order_id"
    )
    plan = session.plan(statement)
    hashed = PhysicalPlanner(session.catalog, prefer_hash_join=True).build(plan)
    looped = PhysicalPlanner(session.catalog, prefer_hash_join=False).build(plan)

    from slateql.execution.context import ExecutionContext
    from slateql.execution.pipeline import collect

    def run(operator):
        context = ExecutionContext(catalog=session.catalog, registry=session.registry)
        return collect(operator, context).to_tuples()

    assert run(hashed) == run(looped)


def test_extract_equi_keys_splits_the_condition():
    left = Schema.of(("a", INTEGER)).qualified("l")
    right = Schema.of(("b", INTEGER)).qualified("r")
    condition = X.combine_and(
        [
            X.BinaryExpr(
                op="=",
                left=X.Column("a", INTEGER, "l"),
                right=X.Column("b", INTEGER, "r"),
                dtype=INTEGER,
            ),
            X.BinaryExpr(
                op=">",
                left=X.Column("a", INTEGER, "l"),
                right=X.Literal(1, INTEGER),
                dtype=INTEGER,
            ),
        ]
    )
    keys = extract_equi_keys(condition, left, right)
    assert keys is not None
    left_keys, right_keys, residual = keys
    assert (left_keys, right_keys) == ([0], [0])
    assert residual is not None


def test_extract_equi_keys_returns_none_without_equalities():
    left = Schema.of(("a", INTEGER)).qualified("l")
    right = Schema.of(("b", INTEGER)).qualified("r")
    condition = X.BinaryExpr(
        op=">",
        left=X.Column("a", INTEGER, "l"),
        right=X.Column("b", INTEGER, "r"),
        dtype=INTEGER,
    )
    assert extract_equi_keys(condition, left, right) is None


def test_reversed_equality_still_yields_keys():
    left = Schema.of(("a", INTEGER)).qualified("l")
    right = Schema.of(("b", INTEGER)).qualified("r")
    condition = X.BinaryExpr(
        op="=",
        left=X.Column("b", INTEGER, "r"),
        right=X.Column("a", INTEGER, "l"),
        dtype=INTEGER,
    )
    keys = extract_equi_keys(condition, left, right)
    assert keys is not None and keys[0] == [0] and keys[1] == [0]


def test_hash_join_requires_at_least_one_key(session):
    from slateql.execution.operators.scan import SingleRowScan
    from slateql.sql.ast_nodes import JoinKind

    with pytest.raises(Exception):
        HashJoinOperator(
            JoinKind.INNER, SingleRowScan(), SingleRowScan(), [], []
        )
