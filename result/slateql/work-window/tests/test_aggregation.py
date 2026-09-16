"""Tests for GROUP BY, HAVING, and aggregate semantics."""

from __future__ import annotations

import pytest


def test_global_count_over_an_empty_table(empty_session):
    empty_session.register_dicts("t", [{"a": 1}])
    result = empty_session.sql("SELECT COUNT(*) AS n FROM t WHERE a > 100")
    assert result.scalar() == 0


def test_global_sum_over_an_empty_table_is_null(empty_session):
    empty_session.register_dicts("t", [{"a": 1}])
    assert empty_session.sql("SELECT SUM(a) AS s FROM t WHERE a > 100").scalar() is None


def test_grouped_aggregate_over_an_empty_table_has_no_rows(session):
    result = session.sql(
        "SELECT city, COUNT(*) FROM customers WHERE id > 100 GROUP BY city"
    )
    assert result.is_empty


def test_count_star_counts_rows_including_nulls(session):
    assert session.sql("SELECT COUNT(*) FROM customers").scalar() == 6


def test_count_column_skips_nulls(session):
    assert session.sql("SELECT COUNT(city) FROM customers").scalar() == 5


def test_count_distinct(session):
    assert session.sql("SELECT COUNT(DISTINCT city) AS n FROM customers").scalar() == 3


def test_sum_distinct(session):
    assert session.sql("SELECT SUM(DISTINCT quantity) AS s FROM orders").scalar() == 11


def test_avg_ignores_nulls(session):
    assert session.sql("SELECT AVG(v) FROM nullable").scalar() == pytest.approx(8 / 3)


def test_min_and_max_ignore_nulls(session):
    result = session.sql("SELECT MIN(v) AS lo, MAX(v) AS hi FROM nullable")
    assert result.to_tuples() == [(1, 4)]


def test_group_by_treats_nulls_as_one_group(session):
    result = session.sql(
        "SELECT k, COUNT(*) AS n FROM nullable GROUP BY k ORDER BY k NULLS FIRST"
    )
    assert result.to_tuples() == [(None, 1), ("a", 2), ("b", 2)]


def test_groups_are_emitted_in_first_appearance_order(session):
    result = session.sql("SELECT city, COUNT(*) FROM customers GROUP BY city")
    assert [row[0] for row in result.rows] == ["Oslo", "Rome", "Lima", None]


def test_group_by_an_expression(session):
    result = session.sql(
        "SELECT LENGTH(city) AS n, COUNT(*) AS c FROM customers "
        "WHERE city IS NOT NULL GROUP BY LENGTH(city)"
    )
    assert result.to_tuples() == [(4, 5)]


def test_having_filters_groups(session):
    result = session.sql(
        "SELECT city, COUNT(*) AS n FROM customers GROUP BY city "
        "HAVING COUNT(*) > 1 ORDER BY city"
    )
    assert result.to_tuples() == [("Oslo", 2), ("Rome", 2)]


def test_having_can_reference_a_group_key(session):
    result = session.sql(
        "SELECT city, COUNT(*) AS n FROM customers GROUP BY city HAVING city = 'Oslo'"
    )
    assert result.to_tuples() == [("Oslo", 2)]


def test_order_by_an_aggregate(session):
    result = session.sql(
        "SELECT city, COUNT(*) AS n FROM customers GROUP BY city "
        "ORDER BY n DESC, city"
    )
    assert [row[0] for row in result.rows][:2] == ["Oslo", "Rome"]


def test_repeated_aggregate_is_computed_once(session):
    plan = session.plan(
        "SELECT city, COUNT(*) AS a, COUNT(*) AS b FROM customers GROUP BY city"
    )
    from slateql.plan.logical import Aggregate

    aggregate = next(node for node in plan.walk() if isinstance(node, Aggregate))
    assert len(aggregate.aggregates) == 1


def test_aggregate_of_an_expression(session):
    result = session.sql(
        "SELECT ROUND(SUM(quantity * unit_price), 2) AS revenue FROM orders"
    )
    assert result.scalar() == pytest.approx(978.75)


def test_multiple_group_keys(session):
    result = session.sql(
        "SELECT city, active, COUNT(*) AS n FROM customers "
        "GROUP BY city, active ORDER BY city NULLS LAST, active"
    )
    assert result.to_tuples()[0] == ("Lima", True, 1)


def test_grouped_aggregate_with_arithmetic_on_a_key(session):
    result = session.sql(
        "SELECT customer_id + 1 AS shifted, COUNT(*) AS n FROM orders "
        "GROUP BY customer_id ORDER BY shifted"
    )
    assert result.to_tuples()[0] == (2, 2)


def test_string_agg_concatenates_within_groups(session):
    result = session.sql(
        "SELECT city, STRING_AGG(name, ', ') AS names FROM customers "
        "WHERE city = 'Oslo' GROUP BY city"
    )
    assert result.to_tuples() == [("Oslo", "Ann Berg, Cy Dunn")]


def test_bool_aggregates(session):
    result = session.sql(
        "SELECT BOOL_AND(active) AS every, BOOL_OR(active) AS some FROM customers"
    )
    assert result.to_tuples() == [(False, True)]


def test_stddev_of_a_constant_series_is_zero(session):
    session.register_dicts("flat", [{"x": 5} for _ in range(4)])
    assert session.sql("SELECT STDDEV_POP(x) FROM flat").scalar() == pytest.approx(0.0)


def test_distinct_is_rejected_for_any_value(session):
    from slateql.errors import SlateQLError

    with pytest.raises(SlateQLError):
        session.sql("SELECT ANY_VALUE(DISTINCT id) FROM customers")
