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


class TestIntersect:
    """INTERSECT and INTERSECT ALL."""

    def test_intersect_keeps_common_rows(self, engine):
        result = engine.sql(
            "SELECT region FROM orders INTERSECT "
            "SELECT region FROM orders WHERE region = 'eu'"
        )
        assert result.to_dicts() == [{"region": "eu"}]

    def test_intersect_empty_when_no_overlap(self, engine):
        result = engine.sql(
            "SELECT region FROM orders WHERE region = 'eu' INTERSECT "
            "SELECT region FROM orders WHERE region = 'us'"
        )
        assert result.to_dicts() == []

    def test_intersect_removes_duplicates_from_left(self, engine):
        # eu appears 3 times on the left; plain INTERSECT keeps it once.
        result = engine.sql(
            "SELECT region FROM orders INTERSECT "
            "SELECT region FROM orders WHERE region = 'eu'"
        )
        assert len(result.to_dicts()) == 1

    def test_intersect_all_keeps_min_copies(self, engine):
        # Left has eu×3, right has eu×3 → min(3,3)=3
        result = engine.sql(
            "SELECT region FROM orders INTERSECT ALL "
            "SELECT region FROM orders WHERE region = 'eu'"
        )
        assert sorted(r["region"] for r in result.to_dicts()) == ["eu", "eu", "eu"]

    def test_intersect_all_min_is_right_count(self, engine):
        # Left has eu×3, right has eu×1 → min(3,1)=1
        result = engine.sql(
            "SELECT region FROM orders INTERSECT ALL "
            "SELECT region FROM orders WHERE region = 'eu' AND id = 1"
        )
        assert sorted(r["region"] for r in result.to_dicts()) == ["eu"]

    def test_intersect_takes_column_names_from_left(self, engine):
        result = engine.sql(
            "SELECT region AS r FROM orders INTERSECT "
            "SELECT status FROM orders WHERE status = 'paid'"
        )
        assert result.column_names == ["r"]

    def test_intersect_requires_matching_widths(self, engine):
        with pytest.raises(PlanningError):
            engine.sql(
                "SELECT region FROM orders INTERSECT "
                "SELECT region, id FROM orders"
            )

    def test_intersect_two_nulls_match(self, engine):
        # Both sides produce the NULL amount row; INTERSECT should keep it.
        result = engine.sql(
            "SELECT amount FROM orders WHERE amount IS NULL INTERSECT "
            "SELECT amount FROM orders WHERE amount IS NULL"
        )
        assert result.to_dicts() == [{"amount": None}]

    def test_intersect_unifies_types(self, engine):
        # left is INT64 (CAST), right is FLOAT64 – they should match on 1→1.0
        result = engine.sql(
            "SELECT CAST(1 AS integer) AS v FROM orders LIMIT 1 "
            "INTERSECT "
            "SELECT CAST(1.0 AS double) AS v FROM orders LIMIT 1"
        )
        assert len(result.to_dicts()) == 1

    def test_intersect_order_by_whole_chain(self, engine):
        result = engine.sql(
            "SELECT region FROM orders INTERSECT "
            "SELECT region FROM orders WHERE amount > 10 "
            "ORDER BY region"
        )
        regions = [r["region"] for r in result.to_dicts()]
        assert regions == sorted(regions)

    def test_intersect_stable_across_batch_sizes(self, engine):
        from veldt.execution.context import ExecutionContext
        from veldt.execution.physical import create_physical_plan
        from veldt.sql.compiler import compile_sql
        from veldt.plan.optimizer import optimize

        sql = "SELECT region FROM orders INTERSECT SELECT region FROM orders WHERE amount > 10"
        plan = optimize(compile_sql(sql, engine.catalog))
        op = create_physical_plan(plan)

        r1 = op.collect(ExecutionContext(batch_size=1)).to_dicts()
        r2 = op.collect(ExecutionContext(batch_size=100)).to_dicts()
        assert r1 == r2

    def test_explain_names_intersect_correctly(self, engine):
        plan = engine.plan(
            "SELECT region FROM orders INTERSECT "
            "SELECT region FROM orders WHERE region = 'eu'"
        )
        description = str(plan)
        assert "Intersect: distinct" in description

    def test_explain_names_intersect_all_correctly(self, engine):
        plan = engine.plan(
            "SELECT region FROM orders INTERSECT ALL "
            "SELECT region FROM orders WHERE region = 'eu'"
        )
        description = str(plan)
        assert "Intersect: all" in description


class TestExcept:
    """EXCEPT and EXCEPT ALL."""

    def test_except_removes_right_rows(self, engine):
        result = engine.sql(
            "SELECT region FROM orders EXCEPT "
            "SELECT region FROM orders WHERE region = 'eu'"
        )
        assert sorted(r["region"] for r in result.to_dicts()) == ["ap", "us"]

    def test_except_empty_result(self, engine):
        result = engine.sql(
            "SELECT region FROM orders EXCEPT "
            "SELECT region FROM orders"
        )
        assert result.to_dicts() == []

    def test_except_keeps_only_left(self, engine):
        result = engine.sql(
            "SELECT region FROM orders WHERE region = 'eu' EXCEPT "
            "SELECT region FROM orders WHERE region = 'us'"
        )
        assert result.to_dicts() == [{"region": "eu"}]

    def test_except_removes_duplicates_from_result(self, engine):
        # left has eu×3, right has no eu → result has eu exactly once
        result = engine.sql(
            "SELECT region FROM orders EXCEPT "
            "SELECT region FROM orders WHERE region = 'us'"
        )
        regions = [r["region"] for r in result.to_dicts()]
        assert regions.count("eu") == 1

    def test_except_all_subtracts_counts(self, engine):
        # Left: eu×3, us×2, ap×1; Right: eu×3 → Result: us×2, ap×1
        result = engine.sql(
            "SELECT region FROM orders EXCEPT ALL "
            "SELECT region FROM orders WHERE region = 'eu'"
        )
        assert sorted(r["region"] for r in result.to_dicts()) == ["ap", "us", "us"]

    def test_except_all_floor_at_zero(self, engine):
        # Right has more eu than left – result should have zero eu rows.
        result = engine.sql(
            "SELECT region FROM orders WHERE region = 'eu' AND id = 1 EXCEPT ALL "
            "SELECT region FROM orders WHERE region = 'eu'"
        )
        assert all(r["region"] != "eu" for r in result.to_dicts())

    def test_except_takes_column_names_from_left(self, engine):
        result = engine.sql(
            "SELECT region AS r FROM orders EXCEPT "
            "SELECT status FROM orders WHERE status = 'paid'"
        )
        assert result.column_names == ["r"]

    def test_except_requires_matching_widths(self, engine):
        with pytest.raises(PlanningError):
            engine.sql(
                "SELECT region FROM orders EXCEPT "
                "SELECT region, id FROM orders"
            )

    def test_except_two_nulls_cancel(self, engine):
        # Both sides have NULL amount; EXCEPT should remove it from the left.
        result = engine.sql(
            "SELECT amount FROM orders WHERE amount IS NULL EXCEPT "
            "SELECT amount FROM orders WHERE amount IS NULL"
        )
        assert result.to_dicts() == []

    def test_except_left_associative(self, engine):
        # a EXCEPT b EXCEPT c  =  (a EXCEPT b) EXCEPT c
        # all EXCEPT eu EXCEPT us  =  (all EXCEPT eu) EXCEPT us  =  {ap}
        result = engine.sql(
            "SELECT region FROM orders "
            "EXCEPT SELECT region FROM orders WHERE region = 'eu' "
            "EXCEPT SELECT region FROM orders WHERE region = 'us'"
        )
        assert result.to_dicts() == [{"region": "ap"}]

    def test_except_order_by_whole_chain(self, engine):
        result = engine.sql(
            "SELECT region FROM orders EXCEPT "
            "SELECT region FROM orders WHERE region = 'eu' "
            "ORDER BY region"
        )
        regions = [r["region"] for r in result.to_dicts()]
        assert regions == sorted(regions)

    def test_except_limit_whole_chain(self, engine):
        result = engine.sql(
            "SELECT region FROM orders EXCEPT "
            "SELECT region FROM orders WHERE region = 'eu' "
            "LIMIT 1"
        )
        assert result.num_rows == 1

    def test_except_stable_across_batch_sizes(self, engine):
        from veldt.execution.context import ExecutionContext
        from veldt.execution.physical import create_physical_plan
        from veldt.sql.compiler import compile_sql
        from veldt.plan.optimizer import optimize

        sql = "SELECT region FROM orders EXCEPT SELECT region FROM orders WHERE region = 'eu'"
        plan = optimize(compile_sql(sql, engine.catalog))
        op = create_physical_plan(plan)

        r1 = sorted(row["region"] for row in op.collect(ExecutionContext(batch_size=1)).to_dicts())
        r2 = sorted(row["region"] for row in op.collect(ExecutionContext(batch_size=100)).to_dicts())
        assert r1 == r2

    def test_explain_names_except_correctly(self, engine):
        plan = engine.plan(
            "SELECT region FROM orders EXCEPT "
            "SELECT region FROM orders WHERE region = 'eu'"
        )
        description = str(plan)
        assert "Except: distinct" in description

    def test_explain_names_except_all_correctly(self, engine):
        plan = engine.plan(
            "SELECT region FROM orders EXCEPT ALL "
            "SELECT region FROM orders WHERE region = 'eu'"
        )
        description = str(plan)
        assert "Except: all" in description


class TestSetOperatorPrecedence:
    """Operator precedence: INTERSECT binds tighter than UNION / EXCEPT."""

    def test_union_intersect_precedence(self, engine):
        # a UNION b INTERSECT c  =  a UNION (b INTERSECT c)
        # eu UNION (us INTERSECT ap)  =  eu UNION {}  =  {eu}
        result = engine.sql(
            "SELECT region FROM orders WHERE region = 'eu' "
            "UNION "
            "SELECT region FROM orders WHERE region = 'us' "
            "INTERSECT "
            "SELECT region FROM orders WHERE region = 'ap'"
        )
        assert result.to_dicts() == [{"region": "eu"}]

    def test_except_intersect_precedence(self, engine):
        # a EXCEPT b INTERSECT c  =  a EXCEPT (b INTERSECT c)
        # all EXCEPT (us INTERSECT ap)  =  all EXCEPT {}  =  all_distinct
        result = engine.sql(
            "SELECT region FROM orders "
            "EXCEPT "
            "SELECT region FROM orders WHERE region = 'us' "
            "INTERSECT "
            "SELECT region FROM orders WHERE region = 'ap'"
        )
        regions = sorted(r["region"] for r in result.to_dicts())
        assert regions == ["ap", "eu", "us"]  # all 3 survive

    def test_union_left_associative(self, engine):
        # a UNION b UNION c  =  (a UNION b) UNION c  (distinct)
        result = engine.sql(
            "SELECT region FROM orders WHERE region = 'eu' "
            "UNION SELECT region FROM orders WHERE region = 'us' "
            "UNION SELECT region FROM orders WHERE region = 'ap'"
        )
        assert sorted(r["region"] for r in result.to_dicts()) == ["ap", "eu", "us"]

    def test_mixed_chain_intersect_binds_tighter(self, engine):
        # eu UNION us INTERSECT us  =  eu UNION (us INTERSECT us)  =  {eu, us}
        result = engine.sql(
            "SELECT region FROM orders WHERE region = 'eu' "
            "UNION "
            "SELECT region FROM orders WHERE region = 'us' "
            "INTERSECT "
            "SELECT region FROM orders WHERE region = 'us'"
        )
        assert sorted(r["region"] for r in result.to_dicts()) == ["eu", "us"]


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
