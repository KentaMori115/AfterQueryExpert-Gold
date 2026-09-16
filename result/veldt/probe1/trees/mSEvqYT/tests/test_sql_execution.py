"""End to end tests: SQL text in, rows out."""

from __future__ import annotations

import pytest

from veldt import Engine
from veldt.errors import (
    ColumnNotFoundError,
    PlanningError,
    TableNotFoundError,
    TypeMismatchError,
)
from veldt.core.table import Table
from veldt.plan.logical import Aggregate, Filter, Join, Project, Scan, Sort


def rows(engine, sql):
    return engine.sql(sql).to_dicts()


def one(engine, sql):
    return engine.sql(sql).scalar()


class TestProjection:
    def test_star_expands_to_every_column(self, engine):
        assert engine.sql("SELECT * FROM orders").column_names == [
            "id",
            "customer",
            "region",
            "amount",
            "status",
        ]

    def test_named_columns_keep_their_order(self, engine):
        assert engine.sql("SELECT region, id FROM orders").column_names == ["region", "id"]

    def test_expressions_are_named_after_their_text(self, engine):
        assert engine.sql("SELECT amount * 2 FROM orders").column_names == ["(amount * 2)"]

    def test_aliases_win(self, engine):
        assert engine.sql("SELECT amount * 2 AS twice FROM orders").column_names == ["twice"]

    def test_duplicate_output_names_are_disambiguated(self, engine):
        assert engine.sql("SELECT id, id FROM orders").column_names == ["id", "id_2"]

    def test_literals_can_be_projected(self, engine):
        assert rows(engine, "SELECT 1 AS one FROM orders")[0] == {"one": 1}

    def test_unknown_columns_are_rejected(self, engine):
        with pytest.raises(ColumnNotFoundError):
            engine.sql("SELECT nope FROM orders")

    def test_unknown_tables_are_rejected(self, engine):
        with pytest.raises(TableNotFoundError):
            engine.sql("SELECT * FROM nope")

    def test_select_without_from_is_rejected(self, engine):
        with pytest.raises(PlanningError):
            engine.sql("SELECT 1")


class TestFiltering:
    def test_simple_comparison(self, engine):
        assert len(rows(engine, "SELECT id FROM orders WHERE amount > 50")) == 3

    def test_null_amounts_are_excluded_by_comparisons(self, engine):
        assert len(rows(engine, "SELECT id FROM orders WHERE amount > 0")) == 5

    def test_is_null_finds_them(self, engine):
        assert one(engine, "SELECT count(*) FROM orders WHERE amount IS NULL") == 1

    def test_conjunctions(self, engine):
        result = rows(engine, "SELECT id FROM orders WHERE region = 'eu' AND status = 'paid'")
        assert [row["id"] for row in result] == [1, 5]

    def test_disjunctions(self, engine):
        assert len(rows(engine, "SELECT id FROM orders WHERE region = 'ap' OR id = 1")) == 2

    def test_in_lists(self, engine):
        assert len(rows(engine, "SELECT id FROM orders WHERE region IN ('eu', 'ap')")) == 4

    def test_between_is_inclusive(self, engine):
        assert len(rows(engine, "SELECT id FROM orders WHERE amount BETWEEN 40.5 AND 120")) == 3

    def test_like_patterns(self, engine):
        assert len(rows(engine, "SELECT id FROM orders WHERE customer LIKE 'b%'")) == 2

    def test_not_negates(self, engine):
        assert len(rows(engine, "SELECT id FROM orders WHERE NOT region = 'eu'")) == 3

    def test_case_expressions(self, engine):
        result = rows(
            engine,
            "SELECT CASE WHEN amount > 100 THEN 'big' ELSE 'small' END AS size FROM orders",
        )
        assert result[0]["size"] == "big"

    def test_type_errors_are_reported(self, engine):
        with pytest.raises(TypeMismatchError):
            engine.sql("SELECT * FROM orders WHERE customer + 1 > 2")


class TestAggregation:
    def test_global_count(self, engine):
        assert one(engine, "SELECT count(*) FROM orders") == 6

    def test_global_aggregate_over_an_empty_input(self, engine):
        assert one(engine, "SELECT count(*) FROM orders WHERE amount > 1000") == 0

    def test_grouped_counts(self, engine):
        result = rows(engine, "SELECT region, count(*) AS n FROM orders GROUP BY region")
        assert {row["region"]: row["n"] for row in result} == {"eu": 3, "us": 2, "ap": 1}

    def test_sums_ignore_nulls(self, engine):
        assert one(engine, "SELECT sum(amount) FROM orders") == pytest.approx(455.75)

    def test_averages_divide_by_non_null_counts(self, engine):
        assert one(engine, "SELECT avg(amount) FROM orders") == pytest.approx(455.75 / 5)

    def test_distinct_aggregates(self, engine):
        assert one(engine, "SELECT count(DISTINCT region) FROM orders") == 3

    def test_expressions_over_aggregates(self, engine):
        result = rows(engine, "SELECT round(sum(amount) / 2, 2) AS half FROM orders")
        assert result[0]["half"] == pytest.approx(227.88, abs=0.01)

    def test_several_aggregates_at_once(self, engine):
        result = rows(engine, "SELECT min(amount) AS lo, max(amount) AS hi FROM orders")
        assert (result[0]["lo"], result[0]["hi"]) == (15.25, 200.0)

    def test_grouping_by_an_expression(self, engine):
        result = rows(engine, "SELECT upper(region) AS r, count(*) AS n FROM orders GROUP BY upper(region)")
        assert {row["r"] for row in result} == {"EU", "US", "AP"}

    def test_having_filters_groups(self, engine):
        result = rows(
            engine,
            "SELECT region, count(*) AS n FROM orders GROUP BY region HAVING count(*) > 1",
        )
        assert {row["region"] for row in result} == {"eu", "us"}

    def test_having_can_use_an_aggregate_not_in_the_projection(self, engine):
        result = rows(
            engine,
            "SELECT region FROM orders GROUP BY region HAVING sum(amount) > 130",
        )
        assert {row["region"] for row in result} == {"eu", "ap"}

    def test_ungrouped_columns_are_rejected(self, engine):
        with pytest.raises(PlanningError):
            engine.sql("SELECT customer, count(*) FROM orders GROUP BY region")

    def test_aggregates_are_rejected_in_where(self, engine):
        with pytest.raises(PlanningError):
            engine.sql("SELECT region FROM orders WHERE count(*) > 1 GROUP BY region")


class TestOrderingAndLimits:
    def test_ordering_ascending_puts_nulls_first(self, engine):
        result = rows(engine, "SELECT amount FROM orders ORDER BY amount")
        assert result[0]["amount"] is None

    def test_ordering_descending_puts_nulls_last(self, engine):
        result = rows(engine, "SELECT amount FROM orders ORDER BY amount DESC")
        assert result[-1]["amount"] is None
        assert result[0]["amount"] == 200.0

    def test_null_placement_can_be_chosen(self, engine):
        result = rows(engine, "SELECT amount FROM orders ORDER BY amount ASC NULLS LAST")
        assert result[-1]["amount"] is None

    def test_ordering_by_an_output_alias(self, engine):
        result = rows(engine, "SELECT amount * 2 AS twice FROM orders ORDER BY twice DESC")
        assert result[0]["twice"] == 400.0

    def test_ordering_by_a_column_that_is_not_selected(self, engine):
        result = rows(engine, "SELECT customer FROM orders ORDER BY amount DESC NULLS LAST")
        assert result[0]["customer"] == "dee"

    def test_ordering_by_an_aggregate(self, engine):
        result = rows(
            engine,
            "SELECT region, sum(amount) AS total FROM orders GROUP BY region ORDER BY total DESC",
        )
        assert result[0]["region"] == "ap"

    def test_secondary_keys_break_ties(self, engine):
        result = rows(engine, "SELECT region, id FROM orders ORDER BY region, id DESC")
        assert [row["id"] for row in result][:2] == [6, 5]

    def test_limit_caps_the_output(self, engine):
        assert len(rows(engine, "SELECT id FROM orders LIMIT 2")) == 2

    def test_offset_skips_rows(self, engine):
        result = rows(engine, "SELECT id FROM orders ORDER BY id LIMIT 2 OFFSET 3")
        assert [row["id"] for row in result] == [4, 5]

    def test_a_limit_beyond_the_input_is_harmless(self, engine):
        assert len(rows(engine, "SELECT id FROM orders LIMIT 99")) == 6


class TestDistinctAndUnion:
    def test_distinct_removes_duplicates(self, engine):
        assert len(rows(engine, "SELECT DISTINCT region FROM orders")) == 3

    def test_distinct_considers_every_selected_column(self, engine):
        assert len(rows(engine, "SELECT DISTINCT region, status FROM orders")) == 5

    def test_union_all_keeps_duplicates(self, engine):
        assert len(rows(engine, "SELECT region FROM orders UNION ALL SELECT region FROM orders")) == 12

    def test_union_removes_duplicates(self, engine):
        assert len(rows(engine, "SELECT region FROM orders UNION SELECT region FROM orders")) == 3

    def test_union_requires_matching_widths(self, engine):
        with pytest.raises(PlanningError):
            engine.sql("SELECT region FROM orders UNION SELECT region, id FROM orders")

    def test_union_takes_names_from_the_left(self, engine):
        result = engine.sql("SELECT region AS r FROM orders UNION SELECT status FROM orders")
        assert result.column_names == ["r"]


class TestJoins:
    def test_inner_join_keeps_matches(self, engine):
        result = rows(
            engine,
            "SELECT o.id, c.tier FROM orders o JOIN customers c ON o.customer = c.customer",
        )
        assert len(result) == 5

    def test_left_join_keeps_unmatched_rows(self, engine):
        result = rows(
            engine,
            "SELECT o.id, c.tier FROM orders o LEFT JOIN customers c ON o.customer = c.customer",
        )
        assert len(result) == 6
        assert any(row["tier"] is None for row in result)

    def test_a_qualified_column_keeps_the_name_it_was_written_with(self, engine):
        result = engine.sql(
            "SELECT c.customer FROM orders o JOIN customers c ON o.customer = c.customer"
        )
        assert result.column_names == ["customer"]

    def test_sorting_above_a_projection_follows_the_output_names(self, engine):
        result = engine.sql(
            "SELECT c.customer, count(*) AS n FROM orders o "
            "JOIN customers c ON o.customer = c.customer "
            "GROUP BY c.customer ORDER BY n DESC, c.customer"
        )
        assert [row["customer"] for row in result.to_dicts()][0] in {"ann", "bob"}

    def test_qualified_columns_resolve_to_the_right_side(self, engine):
        result = rows(
            engine,
            "SELECT o.customer, c.customer AS matched FROM orders o "
            "JOIN customers c ON o.customer = c.customer ORDER BY o.id",
        )
        assert result[0]["customer"] == result[0]["matched"] == "ann"

    def test_a_qualified_star_expands_to_one_side(self, engine):
        result = engine.sql(
            "SELECT c.* FROM orders o JOIN customers c ON o.customer = c.customer"
        )
        assert result.column_names == ["customer_right", "tier", "since"]

    def test_cross_joins_multiply(self, engine):
        assert one(engine, "SELECT count(*) FROM orders CROSS JOIN customers") == 18

    def test_join_conditions_can_be_compound(self, engine):
        result = rows(
            engine,
            "SELECT o.id FROM orders o JOIN customers c "
            "ON o.customer = c.customer AND o.amount > 50",
        )
        assert len(result) == 2

    def test_unknown_qualifiers_are_rejected(self, engine):
        with pytest.raises(PlanningError):
            engine.sql("SELECT z.id FROM orders o")

    def test_duplicate_aliases_are_rejected(self, engine):
        with pytest.raises(PlanningError):
            engine.sql("SELECT o.id FROM orders o JOIN orders o ON o.id = o.id")

    def test_three_way_joins(self, engine):
        result = rows(
            engine,
            "SELECT o.id FROM orders o "
            "JOIN customers c ON o.customer = c.customer "
            "JOIN customers d ON o.customer = d.customer",
        )
        assert len(result) == 5


class TestOptimizerEffects:
    def test_projection_pushdown_narrows_the_scan(self, engine):
        plan = engine.plan("SELECT id FROM orders WHERE amount > 1")
        scan = [node for node in plan.walk() if isinstance(node, Scan)][0]
        assert set(scan.projection) == {"id", "amount"}

    def test_predicate_pushdown_moves_below_the_join(self, engine):
        plan = engine.plan(
            "SELECT o.id FROM orders o JOIN customers c ON o.customer = c.customer "
            "WHERE o.amount > 50"
        )
        join = [node for node in plan.walk() if isinstance(node, Join)][0]
        assert isinstance(join.left, Filter)

    def test_optimization_does_not_change_the_answer(self, engine):
        sql = (
            "SELECT region, count(*) AS n FROM orders WHERE amount > 1 + 0 "
            "GROUP BY region HAVING count(*) >= 1 ORDER BY n DESC, region"
        )
        optimized = engine.sql(sql).to_dicts()
        plain = engine.with_config(optimize=False).sql(sql).to_dicts()
        assert optimized == plain

    def test_explain_shows_the_plan(self, engine):
        assert "Scan" in engine.explain("SELECT id FROM orders")

    def test_explain_can_show_the_unoptimized_plan(self, engine):
        assert "Scan: orders" in engine.explain("SELECT id FROM orders", optimized=False)


class TestResultMetadata:
    def test_metrics_are_collected(self, engine):
        result = engine.sql("SELECT id FROM orders")
        assert result.metric("result.rows") == 6

    def test_the_statement_is_recorded(self, engine):
        assert engine.sql("SELECT id FROM orders").sql.startswith("SELECT")

    def test_both_plans_are_recorded(self, engine):
        result = engine.sql("SELECT id FROM orders WHERE amount > 1")
        assert result.logical_plan is not None
        assert result.optimized_plan is not result.logical_plan

    def test_metrics_can_be_disabled(self, engine):
        quiet = engine.with_config(collect_metrics=False)
        assert quiet.sql("SELECT id FROM orders").metrics == {}

    def test_batch_size_does_not_change_the_answer(self, engine):
        small = engine.with_config(batch_size=1)
        sql = "SELECT region, count(*) AS n FROM orders GROUP BY region ORDER BY region"
        assert small.sql(sql).to_dicts() == engine.sql(sql).to_dicts()


class TestIntersectAndExcept:
    """End-to-end tests for INTERSECT and EXCEPT."""

    @pytest.fixture
    def ab_engine(self):
        """Engine with two small tables a_tbl and b_tbl."""
        from veldt import Engine
        from veldt.storage.catalog import Catalog
        from veldt.storage.memory import MemorySource

        catalog = Catalog()
        catalog.register(
            "a_tbl",
            MemorySource("a_tbl", Table.from_dicts([{"v": 1}, {"v": 2}, {"v": 3}])),
        )
        catalog.register(
            "b_tbl",
            MemorySource("b_tbl", Table.from_dicts([{"v": 2}, {"v": 3}, {"v": 4}])),
        )
        return Engine(catalog)

    def test_intersect_keeps_common_rows(self, ab_engine):
        result = ab_engine.sql("SELECT v FROM a_tbl INTERSECT SELECT v FROM b_tbl")
        assert sorted(result.column("v")) == [2, 3]

    def test_intersect_removes_duplicates_by_default(self, ab_engine):
        # Both sides have v=2 and v=3; result should be distinct.
        result = ab_engine.sql("SELECT v FROM a_tbl INTERSECT SELECT v FROM b_tbl")
        assert result.num_rows == 2

    def test_intersect_all_applies_min_counts(self):
        from veldt import Engine
        from veldt.storage.catalog import Catalog
        from veldt.storage.memory import MemorySource

        catalog = Catalog()
        catalog.register(
            "t",
            MemorySource("t", Table.from_dicts([{"v": 1}, {"v": 2}, {"v": 2}, {"v": 3}])),
        )
        catalog.register(
            "u",
            MemorySource("u", Table.from_dicts([{"v": 2}, {"v": 2}, {"v": 2}, {"v": 3}])),
        )
        engine = Engine(catalog)
        result = engine.sql("SELECT v FROM t INTERSECT ALL SELECT v FROM u")
        # v=1: min(1,0)=0; v=2: min(2,3)=2; v=3: min(1,1)=1
        assert sorted(result.column("v")) == [2, 2, 3]

    def test_except_keeps_left_only_rows(self, ab_engine):
        result = ab_engine.sql("SELECT v FROM a_tbl EXCEPT SELECT v FROM b_tbl")
        assert list(result.column("v")) == [1]

    def test_except_removes_duplicates_by_default(self):
        from veldt import Engine
        from veldt.storage.catalog import Catalog
        from veldt.storage.memory import MemorySource

        catalog = Catalog()
        catalog.register(
            "t",
            MemorySource("t", Table.from_dicts([{"v": 1}, {"v": 1}, {"v": 2}])),
        )
        catalog.register(
            "u",
            MemorySource("u", Table.from_dicts([{"v": 2}])),
        )
        engine = Engine(catalog)
        result = engine.sql("SELECT v FROM t EXCEPT SELECT v FROM u")
        # v=1 appears twice on left, not on right -> distinct -> 1 row
        assert result.num_rows == 1
        assert list(result.column("v")) == [1]

    def test_except_all_subtracts_counts(self):
        from veldt import Engine
        from veldt.storage.catalog import Catalog
        from veldt.storage.memory import MemorySource

        catalog = Catalog()
        catalog.register(
            "t",
            MemorySource("t", Table.from_dicts([
                {"v": 1}, {"v": 2}, {"v": 2}, {"v": 2}, {"v": 3}
            ])),
        )
        catalog.register(
            "u",
            MemorySource("u", Table.from_dicts([{"v": 2}, {"v": 2}])),
        )
        engine = Engine(catalog)
        result = engine.sql("SELECT v FROM t EXCEPT ALL SELECT v FROM u")
        # v=1: max(1-0,0)=1; v=2: max(3-2,0)=1; v=3: max(1-0,0)=1
        assert sorted(result.column("v")) == [1, 2, 3]

    def test_except_all_floors_at_zero(self):
        from veldt import Engine
        from veldt.storage.catalog import Catalog
        from veldt.storage.memory import MemorySource

        catalog = Catalog()
        catalog.register(
            "t",
            MemorySource("t", Table.from_dicts([{"v": 1}])),
        )
        catalog.register(
            "u",
            MemorySource("u", Table.from_dicts([{"v": 1}, {"v": 1}])),
        )
        engine = Engine(catalog)
        result = engine.sql("SELECT v FROM t EXCEPT ALL SELECT v FROM u")
        assert result.num_rows == 0

    def test_intersect_requires_matching_column_count(self, ab_engine):
        with pytest.raises(PlanningError):
            ab_engine.sql(
                "SELECT v FROM a_tbl INTERSECT SELECT v, v FROM b_tbl"
            )

    def test_except_requires_matching_column_count(self, ab_engine):
        with pytest.raises(PlanningError):
            ab_engine.sql(
                "SELECT v FROM a_tbl EXCEPT SELECT v, v FROM b_tbl"
            )

    def test_intersect_takes_names_from_left(self):
        from veldt import Engine
        from veldt.storage.catalog import Catalog
        from veldt.storage.memory import MemorySource

        catalog = Catalog()
        catalog.register(
            "t",
            MemorySource("t", Table.from_dicts([{"x": 1}])),
        )
        catalog.register(
            "u",
            MemorySource("u", Table.from_dicts([{"y": 1}])),
        )
        engine = Engine(catalog)
        result = engine.sql("SELECT x FROM t INTERSECT SELECT y FROM u")
        assert result.column_names == ["x"]

    def test_except_takes_names_from_left(self):
        from veldt import Engine
        from veldt.storage.catalog import Catalog
        from veldt.storage.memory import MemorySource

        catalog = Catalog()
        catalog.register(
            "t",
            MemorySource("t", Table.from_dicts([{"x": 1}])),
        )
        catalog.register(
            "u",
            MemorySource("u", Table.from_dicts([{"y": 2}])),
        )
        engine = Engine(catalog)
        result = engine.sql("SELECT x FROM t EXCEPT SELECT y FROM u")
        assert result.column_names == ["x"]

    def test_nulls_intersect_each_other(self):
        from veldt import Engine
        from veldt.storage.catalog import Catalog
        from veldt.storage.memory import MemorySource

        catalog = Catalog()
        catalog.register(
            "t",
            MemorySource("t", Table.from_dicts([{"v": None}, {"v": 1}])),
        )
        catalog.register(
            "u",
            MemorySource("u", Table.from_dicts([{"v": None}, {"v": 2}])),
        )
        engine = Engine(catalog)
        result = engine.sql("SELECT v FROM t INTERSECT SELECT v FROM u")
        assert result.num_rows == 1
        assert result.column("v")[0] is None

    def test_nulls_cancel_in_except(self):
        from veldt import Engine
        from veldt.storage.catalog import Catalog
        from veldt.storage.memory import MemorySource

        catalog = Catalog()
        catalog.register(
            "t",
            MemorySource("t", Table.from_dicts([{"v": None}, {"v": 1}])),
        )
        catalog.register(
            "u",
            MemorySource("u", Table.from_dicts([{"v": None}])),
        )
        engine = Engine(catalog)
        result = engine.sql("SELECT v FROM t EXCEPT SELECT v FROM u")
        assert result.num_rows == 1
        assert result.column("v")[0] == 1

    def test_union_intersect_precedence(self):
        """INTERSECT binds tighter: a UNION b INTERSECT c = a UNION (b INTERSECT c)."""
        from veldt import Engine
        from veldt.storage.catalog import Catalog
        from veldt.storage.memory import MemorySource

        catalog = Catalog()
        catalog.register(
            "a_tbl",
            MemorySource("a_tbl", Table.from_dicts([{"v": 1}, {"v": 2}])),
        )
        catalog.register(
            "b_tbl",
            MemorySource("b_tbl", Table.from_dicts([{"v": 2}, {"v": 3}])),
        )
        catalog.register(
            "c_tbl",
            MemorySource("c_tbl", Table.from_dicts([{"v": 3}, {"v": 4}])),
        )
        engine = Engine(catalog)
        result = engine.sql(
            "SELECT v FROM a_tbl UNION SELECT v FROM b_tbl INTERSECT SELECT v FROM c_tbl"
        )
        # b INTERSECT c = {3}; a UNION {3} = {1, 2, 3}
        assert sorted(result.column("v")) == [1, 2, 3]

    def test_except_left_associativity(self):
        """a EXCEPT b EXCEPT c = (a EXCEPT b) EXCEPT c."""
        from veldt import Engine
        from veldt.storage.catalog import Catalog
        from veldt.storage.memory import MemorySource

        catalog = Catalog()
        catalog.register(
            "a_tbl",
            MemorySource("a_tbl", Table.from_dicts([{"v": 1}, {"v": 2}, {"v": 3}])),
        )
        catalog.register(
            "b_tbl",
            MemorySource("b_tbl", Table.from_dicts([{"v": 2}])),
        )
        catalog.register(
            "c_tbl",
            MemorySource("c_tbl", Table.from_dicts([{"v": 3}])),
        )
        engine = Engine(catalog)
        result = engine.sql(
            "SELECT v FROM a_tbl EXCEPT SELECT v FROM b_tbl EXCEPT SELECT v FROM c_tbl"
        )
        assert list(result.column("v")) == [1]

    def test_order_by_applies_to_intersect_chain(self):
        from veldt import Engine
        from veldt.storage.catalog import Catalog
        from veldt.storage.memory import MemorySource

        catalog = Catalog()
        catalog.register(
            "t",
            MemorySource("t", Table.from_dicts([{"v": 1}, {"v": 2}, {"v": 3}])),
        )
        catalog.register(
            "u",
            MemorySource("u", Table.from_dicts([{"v": 2}, {"v": 3}, {"v": 4}])),
        )
        engine = Engine(catalog)
        result = engine.sql(
            "SELECT v FROM t INTERSECT SELECT v FROM u ORDER BY v DESC"
        )
        assert list(result.column("v")) == [3, 2]

    def test_limit_applies_to_except_chain(self):
        from veldt import Engine
        from veldt.storage.catalog import Catalog
        from veldt.storage.memory import MemorySource

        catalog = Catalog()
        catalog.register(
            "t",
            MemorySource("t", Table.from_dicts([{"v": 1}, {"v": 2}, {"v": 3}])),
        )
        catalog.register(
            "u",
            MemorySource("u", Table.from_dicts([{"v": 4}])),
        )
        engine = Engine(catalog)
        result = engine.sql(
            "SELECT v FROM t EXCEPT SELECT v FROM u ORDER BY v LIMIT 2"
        )
        assert list(result.column("v")) == [1, 2]

    def test_intersect_explain_names(self):
        from veldt.plan.logical import Intersect
        from veldt.sql.compiler import compile_sql

        plan_d = compile_sql(
            "SELECT v FROM a_tbl INTERSECT SELECT v FROM b_tbl",
            ab_engine.catalog if hasattr(ab_engine, "catalog") else None,
        ) if False else None  # tested below via ab_engine fixture directly

        from veldt.storage.catalog import Catalog
        from veldt.storage.memory import MemorySource

        catalog = Catalog()
        catalog.register("t", MemorySource("t", Table.from_dicts([{"v": 1}])))
        catalog.register("u", MemorySource("u", Table.from_dicts([{"v": 1}])))
        from veldt.sql.compiler import compile_sql as cs
        plan_d = cs("SELECT v FROM t INTERSECT SELECT v FROM u", catalog)
        plan_a = cs("SELECT v FROM t INTERSECT ALL SELECT v FROM u", catalog)
        assert isinstance(plan_d, Intersect)
        assert plan_d.describe() == "Intersect: distinct"
        assert isinstance(plan_a, Intersect)
        assert plan_a.describe() == "Intersect: all"

    def test_except_explain_names(self):
        from veldt.plan.logical import Except
        from veldt.storage.catalog import Catalog
        from veldt.storage.memory import MemorySource

        catalog = Catalog()
        catalog.register("t", MemorySource("t", Table.from_dicts([{"v": 1}])))
        catalog.register("u", MemorySource("u", Table.from_dicts([{"v": 2}])))
        from veldt.sql.compiler import compile_sql as cs
        plan_d = cs("SELECT v FROM t EXCEPT SELECT v FROM u", catalog)
        plan_a = cs("SELECT v FROM t EXCEPT ALL SELECT v FROM u", catalog)
        assert isinstance(plan_d, Except)
        assert plan_d.describe() == "Except: distinct"
        assert isinstance(plan_a, Except)
        assert plan_a.describe() == "Except: all"
