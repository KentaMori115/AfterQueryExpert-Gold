"""Cross-cutting invariants.

These tests do not check that a particular query returns a particular row.
They check the properties the engine claims hold for *every* query: that
optimization does not change results, that batch size does not change results,
and that the fixes for past bugs stay fixed.
"""

from __future__ import annotations

import pytest

from veldt import Engine
from veldt.plan.logical import Filter, Join, Scan
from veldt.plan.optimizer import default_optimizer

QUERIES = [
    "SELECT * FROM orders",
    "SELECT id, amount FROM orders WHERE amount > 20",
    "SELECT id FROM orders WHERE amount IS NULL OR region = 'ap'",
    "SELECT DISTINCT region FROM orders",
    "SELECT region, count(*) AS n FROM orders GROUP BY region",
    "SELECT region, sum(amount) AS total FROM orders GROUP BY region HAVING sum(amount) > 100",
    "SELECT customer FROM orders ORDER BY amount DESC NULLS LAST LIMIT 3",
    "SELECT amount * 2 AS twice FROM orders ORDER BY twice",
    "SELECT region FROM orders UNION SELECT status FROM orders",
    "SELECT region FROM orders UNION ALL SELECT status FROM orders",
    "SELECT region FROM orders INTERSECT SELECT region FROM orders WHERE amount > 50",
    "SELECT region FROM orders INTERSECT ALL SELECT region FROM orders WHERE amount > 50",
    "SELECT status FROM orders EXCEPT SELECT status FROM orders WHERE region = 'eu'",
    "SELECT status FROM orders EXCEPT ALL SELECT status FROM orders WHERE region = 'eu'",
    "SELECT region FROM orders UNION SELECT status FROM orders EXCEPT SELECT region FROM orders",
    "SELECT customer FROM orders INTERSECT SELECT customer FROM orders WHERE amount > 20 "
    "ORDER BY customer LIMIT 2",
    "SELECT o.id, c.tier FROM orders o JOIN customers c ON o.customer = c.customer",
    "SELECT o.id, c.tier FROM orders o LEFT JOIN customers c ON o.customer = c.customer",
    "SELECT count(*) AS n FROM orders CROSS JOIN customers",
    "SELECT upper(region) AS r, count(DISTINCT customer) AS people FROM orders GROUP BY upper(region)",
    "SELECT id FROM orders WHERE id IN (1, 2, 3) AND status <> 'paid'",
    "SELECT id, CASE WHEN amount > 100 THEN 'big' ELSE 'small' END AS size FROM orders",
    "SELECT id FROM orders WHERE customer LIKE '%n%' ORDER BY id LIMIT 2 OFFSET 1",
]


def sorted_rows(result):
    """Return rows in a stable order so unordered queries still compare."""
    return sorted(result.to_rows(), key=lambda row: [str(value) for value in row])


class TestOptimizerEquivalence:
    @pytest.mark.parametrize("sql", QUERIES)
    def test_optimization_preserves_rows(self, engine, sql):
        plain = engine.with_config(optimize=False)
        assert sorted_rows(engine.sql(sql)) == sorted_rows(plain.sql(sql))

    @pytest.mark.parametrize("sql", QUERIES)
    def test_optimization_preserves_the_schema(self, engine, sql):
        plain = engine.with_config(optimize=False)
        assert engine.sql(sql).schema == plain.sql(sql).schema

    @pytest.mark.parametrize("sql", QUERIES)
    def test_optimization_reaches_a_fixpoint(self, engine, sql):
        optimizer = default_optimizer()
        once = optimizer.optimize(engine.plan(sql, optimize=False))
        optimizer.optimize(once)
        assert optimizer.last_report.converged


class TestBatchSizeIndependence:
    @pytest.mark.parametrize("sql", QUERIES)
    @pytest.mark.parametrize("batch_size", [1, 2, 5])
    def test_batch_size_does_not_change_rows(self, engine, sql, batch_size):
        small = engine.with_config(batch_size=batch_size)
        assert sorted_rows(small.sql(sql)) == sorted_rows(engine.sql(sql))


class TestDeterminism:
    @pytest.mark.parametrize("sql", QUERIES)
    def test_repeated_runs_agree(self, engine, sql):
        assert engine.sql(sql).to_rows() == engine.sql(sql).to_rows()

    def test_group_order_is_stable_across_runs(self, engine):
        sql = "SELECT region, count(*) AS n FROM orders GROUP BY region"
        first = [row["region"] for row in engine.sql(sql).to_dicts()]
        second = [row["region"] for row in engine.sql(sql).to_dicts()]
        assert first == second


class TestRegressions:
    def test_equi_join_does_not_collapse_into_a_self_comparison(self, engine):
        """Both sides carry a `customer` column; the join must still filter."""
        result = engine.sql(
            "SELECT o.id FROM orders o JOIN customers c ON o.customer = c.customer"
        )
        assert result.num_rows == 5

    def test_a_predicate_is_pushed_to_the_side_that_owns_it(self, engine):
        """Both inputs have a `customer` column, so sides come from the merge."""
        plan = engine.plan(
            "SELECT o.id FROM orders o JOIN customers c ON o.customer = c.customer "
            "WHERE c.tier = 'gold'"
        )
        join = [node for node in plan.walk() if isinstance(node, Join)][0]
        pushed = join.right if isinstance(join.right, Filter) else None
        assert pushed is not None
        assert "tier" in pushed.predicate.to_sql()

    def test_a_projection_is_not_aliased_twice(self, engine):
        result = engine.sql(
            "SELECT round(sum(amount), 1) AS total FROM orders GROUP BY region"
        )
        assert result.column_names == ["total"]

    def test_a_blank_line_in_a_csv_is_not_a_row(self, tmp_path, engine):
        path = tmp_path / "gappy.csv"
        path.write_text("id,name\n1,ann\n\n2,bob\n", encoding="utf-8")
        engine.register_csv("gappy", str(path))
        assert engine.sql("SELECT count(*) FROM gappy").scalar() == 2

    def test_a_typo_in_a_table_alias_is_an_error(self, engine):
        with pytest.raises(Exception):
            engine.sql("SELECT ordrs.id FROM orders o")

    def test_partition_pruning_survives_a_typed_key(self, partitioned_root):
        engine = Engine()
        engine.register_partitioned("events", partitioned_root)
        result = engine.sql("SELECT count(*) AS n FROM events WHERE region = 'eu'")
        assert result.scalar() == 3

    def test_union_all_parses(self, engine):
        assert engine.sql(
            "SELECT region FROM orders UNION ALL SELECT region FROM orders"
        ).num_rows == 12

    def test_a_trailing_order_by_orders_the_whole_chain(self, engine):
        """It used to order the last select only, which the union then undid."""
        result = engine.sql(
            "SELECT region FROM orders UNION SELECT status FROM orders ORDER BY region"
        )
        values = [row["region"] for row in result.to_dicts()]
        assert values == sorted(values)

    def test_a_trailing_limit_limits_the_whole_chain(self, engine):
        result = engine.sql(
            "SELECT region FROM orders UNION ALL SELECT status FROM orders LIMIT 7"
        )
        assert result.num_rows == 7

    def test_a_custom_aggregate_is_parsed_as_one(self, engine):
        from veldt.expr.aggregates import Accumulator, AggregateFunction
        from veldt.types.dtypes import DataType

        class Span(Accumulator):
            def __init__(self):
                self.low = None
                self.high = None

            def update(self, value):
                if value is None:
                    return
                self.low = value if self.low is None else min(self.low, value)
                self.high = value if self.high is None else max(self.high, value)

            def merge(self, other):
                self.update(other.low)
                self.update(other.high)

            def finalize(self):
                if self.low is None:
                    return None
                return self.high - self.low

        engine.register_aggregate(
            AggregateFunction("span", lambda types: Span(), DataType.FLOAT64)
        )
        assert engine.sql("SELECT span(amount) AS s FROM orders").scalar() == pytest.approx(184.75)
