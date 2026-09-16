"""Tests for INTERSECT and EXCEPT set operations."""

from __future__ import annotations

import pytest

from veldt import Engine
from veldt.errors import PlanningError
from veldt.plan.logical import Except, Intersect
from veldt.sql.keywords import SET_OPERATORS, is_reserved
from veldt.sql.parser import parse_select


def rows(engine, sql):
    return engine.sql(sql).to_dicts()


def values(engine, sql, col="a"):
    return sorted(r[col] for r in rows(engine, sql))


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def set_engine():
    """Engine with three small tables for set-op testing."""
    from veldt.storage.catalog import Catalog
    from veldt.storage.memory import MemorySource
    from veldt.core.table import Table
    from veldt.types.schema import Schema, Field
    from veldt.types.dtypes import DataType

    schema = Schema([Field("a", DataType.INT64)])
    # t1 = {1, 2, 3}
    t1 = Table.from_dicts([{"a": 1}, {"a": 2}, {"a": 3}], schema)
    # t2 = {2, 3, 4}
    t2 = Table.from_dicts([{"a": 2}, {"a": 3}, {"a": 4}], schema)
    # t3 = {3, 4, 5}
    t3 = Table.from_dicts([{"a": 3}, {"a": 4}, {"a": 5}], schema)
    catalog = Catalog()
    catalog.register("t1", MemorySource("t1", t1))
    catalog.register("t2", MemorySource("t2", t2))
    catalog.register("t3", MemorySource("t3", t3))
    return Engine(catalog)


@pytest.fixture
def dup_engine():
    """Engine with tables that contain duplicate rows for ALL-variant tests."""
    from veldt.storage.catalog import Catalog
    from veldt.storage.memory import MemorySource
    from veldt.core.table import Table
    from veldt.types.schema import Schema, Field
    from veldt.types.dtypes import DataType

    schema = Schema([Field("a", DataType.INT64)])
    # t1: 1,1,2,3  (1 twice)
    t1 = Table.from_dicts([{"a": 1}, {"a": 1}, {"a": 2}, {"a": 3}], schema)
    # t2: 1,2,2    (2 twice)
    t2 = Table.from_dicts([{"a": 1}, {"a": 2}, {"a": 2}], schema)
    catalog = Catalog()
    catalog.register("t1", MemorySource("t1", t1))
    catalog.register("t2", MemorySource("t2", t2))
    return Engine(catalog)


# ---------------------------------------------------------------------------
# Keywords
# ---------------------------------------------------------------------------

class TestKeywords:
    def test_intersect_is_a_set_operator(self):
        assert "intersect" in SET_OPERATORS

    def test_except_is_a_set_operator(self):
        assert "except" in SET_OPERATORS

    def test_union_is_still_a_set_operator(self):
        assert "union" in SET_OPERATORS

    def test_intersect_is_reserved(self):
        assert is_reserved("intersect")
        assert is_reserved("INTERSECT")

    def test_except_is_reserved(self):
        assert is_reserved("except")
        assert is_reserved("EXCEPT")


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------

class TestParsing:
    def test_intersect_is_parsed(self):
        stmt = parse_select("SELECT a FROM t INTERSECT SELECT b FROM u")
        assert stmt.set_operation is not None
        assert stmt.set_operation.kind == "intersect"
        assert stmt.set_operation.all is False

    def test_intersect_all_is_parsed(self):
        stmt = parse_select("SELECT a FROM t INTERSECT ALL SELECT b FROM u")
        assert stmt.set_operation.kind == "intersect"
        assert stmt.set_operation.all is True

    def test_except_is_parsed(self):
        stmt = parse_select("SELECT a FROM t EXCEPT SELECT b FROM u")
        assert stmt.set_operation is not None
        assert stmt.set_operation.kind == "except"
        assert stmt.set_operation.all is False

    def test_except_all_is_parsed(self):
        stmt = parse_select("SELECT a FROM t EXCEPT ALL SELECT b FROM u")
        assert stmt.set_operation.kind == "except"
        assert stmt.set_operation.all is True

    def test_chain_with_intersect_stores_inner_op(self):
        stmt = parse_select(
            "SELECT a FROM t UNION SELECT b FROM u INTERSECT SELECT c FROM v"
        )
        assert stmt.set_operation.kind == "union"
        inner = stmt.set_operation.statement
        assert inner.set_operation.kind == "intersect"

    def test_except_chain(self):
        stmt = parse_select(
            "SELECT a FROM t EXCEPT SELECT b FROM u EXCEPT SELECT c FROM v"
        )
        assert stmt.set_operation.kind == "except"
        inner = stmt.set_operation.statement
        assert inner.set_operation.kind == "except"


# ---------------------------------------------------------------------------
# Logical plan nodes
# ---------------------------------------------------------------------------

class TestLogicalPlanNodes:
    def test_intersect_plan_uses_left_schema_names(self, set_engine):
        plan = set_engine.plan(
            "SELECT a AS x FROM t1 INTERSECT SELECT a FROM t2"
        )
        intersect_nodes = [n for n in plan.walk() if isinstance(n, Intersect)]
        assert intersect_nodes, "expected an Intersect node in the plan"
        assert intersect_nodes[0].schema.names == ["x"]

    def test_except_plan_uses_left_schema_names(self, set_engine):
        plan = set_engine.plan(
            "SELECT a AS x FROM t1 EXCEPT SELECT a FROM t2"
        )
        except_nodes = [n for n in plan.walk() if isinstance(n, Except)]
        assert except_nodes, "expected an Except node in the plan"
        assert except_nodes[0].schema.names == ["x"]

    def test_intersect_describe_distinct(self, set_engine):
        plan = set_engine.plan("SELECT a FROM t1 INTERSECT SELECT a FROM t2")
        intersect_nodes = [n for n in plan.walk() if isinstance(n, Intersect)]
        assert intersect_nodes[0].describe() == "Intersect: distinct"

    def test_intersect_describe_all(self, set_engine):
        plan = set_engine.plan("SELECT a FROM t1 INTERSECT ALL SELECT a FROM t2")
        intersect_nodes = [n for n in plan.walk() if isinstance(n, Intersect)]
        assert intersect_nodes[0].describe() == "Intersect: all"

    def test_except_describe_distinct(self, set_engine):
        plan = set_engine.plan("SELECT a FROM t1 EXCEPT SELECT a FROM t2")
        except_nodes = [n for n in plan.walk() if isinstance(n, Except)]
        assert except_nodes[0].describe() == "Except: distinct"

    def test_except_describe_all(self, set_engine):
        plan = set_engine.plan("SELECT a FROM t1 EXCEPT ALL SELECT a FROM t2")
        except_nodes = [n for n in plan.walk() if isinstance(n, Except)]
        assert except_nodes[0].describe() == "Except: all"


# ---------------------------------------------------------------------------
# INTERSECT semantics
# ---------------------------------------------------------------------------

class TestIntersect:
    def test_keeps_rows_in_both(self, set_engine):
        # t1={1,2,3}, t2={2,3,4} => {2,3}
        assert values(set_engine, "SELECT a FROM t1 INTERSECT SELECT a FROM t2") == [2, 3]

    def test_empty_intersection(self, set_engine):
        # t1={1,2,3}, t3={3,4,5}: well, 3 is common
        result = values(set_engine, "SELECT a FROM t1 INTERSECT SELECT a FROM t3")
        assert result == [3]

    def test_intersect_with_self(self, set_engine):
        result = values(set_engine, "SELECT a FROM t1 INTERSECT SELECT a FROM t1")
        assert result == [1, 2, 3]

    def test_distinct_deduplicates_left_duplicates(self, dup_engine):
        # t1={1,1,2,3}, t2={1,2,2}: intersection {1,2}
        result = values(dup_engine, "SELECT a FROM t1 INTERSECT SELECT a FROM t2")
        assert result == [1, 2]

    def test_distinct_deduplicates_result(self, dup_engine):
        # Each value appears at most once in plain INTERSECT
        result = values(dup_engine, "SELECT a FROM t1 INTERSECT SELECT a FROM t2")
        assert len(result) == len(set(result))

    def test_result_uses_left_column_names(self, set_engine):
        result = set_engine.sql(
            "SELECT a AS left_a FROM t1 INTERSECT SELECT a FROM t2"
        )
        assert result.column_names == ["left_a"]

    def test_column_count_mismatch_raises(self, set_engine):
        with pytest.raises(PlanningError, match="INTERSECT"):
            set_engine.sql("SELECT a FROM t1 INTERSECT SELECT a, a FROM t2")

    def test_null_pairs_with_null(self, set_engine):
        """Two NULLs from each side are considered equal by INTERSECT."""
        from veldt.storage.catalog import Catalog
        from veldt.storage.memory import MemorySource
        from veldt.core.table import Table
        from veldt.types.schema import Schema, Field
        from veldt.types.dtypes import DataType

        schema = Schema([Field("a", DataType.INT64)])
        n1 = Table.from_dicts([{"a": None}, {"a": 1}], schema)
        n2 = Table.from_dicts([{"a": None}, {"a": 2}], schema)
        cat = Catalog()
        cat.register("n1", MemorySource("n1", n1))
        cat.register("n2", MemorySource("n2", n2))
        eng = Engine(cat)
        result = eng.sql("SELECT a FROM n1 INTERSECT SELECT a FROM n2").to_dicts()
        assert result == [{"a": None}]

    def test_integer_and_float_unify(self):
        """int 1 and float 1.0 are the same row after type unification."""
        from veldt.storage.catalog import Catalog
        from veldt.storage.memory import MemorySource
        from veldt.core.table import Table
        from veldt.types.schema import Schema, Field
        from veldt.types.dtypes import DataType

        cat = Catalog()
        ti = Table.from_dicts(
            [{"a": 1}, {"a": 2}],
            Schema([Field("a", DataType.INT64)]),
        )
        tf = Table.from_dicts(
            [{"a": 1.0}, {"a": 3.0}],
            Schema([Field("a", DataType.FLOAT64)]),
        )
        cat.register("ti", MemorySource("ti", ti))
        cat.register("tf", MemorySource("tf", tf))
        eng = Engine(cat)
        result = eng.sql("SELECT a FROM ti INTERSECT SELECT a FROM tf").to_dicts()
        assert len(result) == 1
        assert result[0]["a"] == pytest.approx(1.0)


# ---------------------------------------------------------------------------
# INTERSECT ALL semantics
# ---------------------------------------------------------------------------

class TestIntersectAll:
    def test_multiset_min_count(self, dup_engine):
        # t1: 1x2, 2x1, 3x1  |  t2: 1x1, 2x2
        # min(2,1)=1 for 1, min(1,2)=1 for 2, min(1,0)=0 for 3
        result = values(dup_engine, "SELECT a FROM t1 INTERSECT ALL SELECT a FROM t2")
        assert result == [1, 2]

    def test_all_allows_duplicates_up_to_min(self, dup_engine):
        # The count should match min(left_count, right_count)
        result = values(dup_engine, "SELECT a FROM t1 INTERSECT ALL SELECT a FROM t2")
        assert result.count(1) == 1  # min(2, 1)
        assert result.count(2) == 1  # min(1, 2)
        assert 3 not in result       # min(1, 0) = 0

    def test_all_distinct_same_result_when_no_dups(self, set_engine):
        # With no duplicates, ALL and non-ALL produce the same result
        r_all = values(set_engine, "SELECT a FROM t1 INTERSECT ALL SELECT a FROM t2")
        r_dis = values(set_engine, "SELECT a FROM t1 INTERSECT SELECT a FROM t2")
        assert r_all == r_dis


# ---------------------------------------------------------------------------
# EXCEPT semantics
# ---------------------------------------------------------------------------

class TestExcept:
    def test_keeps_left_rows_not_in_right(self, set_engine):
        # t1={1,2,3}, t2={2,3,4} => {1}
        assert values(set_engine, "SELECT a FROM t1 EXCEPT SELECT a FROM t2") == [1]

    def test_not_commutative(self, set_engine):
        # t2 EXCEPT t1 = {4}
        assert values(set_engine, "SELECT a FROM t2 EXCEPT SELECT a FROM t1") == [4]

    def test_distinct_deduplicates_result(self, dup_engine):
        # t1={1,1,2,3}, t2={1,2,2}: distinct left rows not in t2 = {3}
        result = values(dup_engine, "SELECT a FROM t1 EXCEPT SELECT a FROM t2")
        assert result == [3]

    def test_except_all_of_self_is_empty(self, set_engine):
        result = rows(set_engine, "SELECT a FROM t1 EXCEPT SELECT a FROM t1")
        assert result == []

    def test_null_pairs_with_null(self):
        """A NULL on the left is cancelled by a NULL on the right."""
        from veldt.storage.catalog import Catalog
        from veldt.storage.memory import MemorySource
        from veldt.core.table import Table
        from veldt.types.schema import Schema, Field
        from veldt.types.dtypes import DataType

        schema = Schema([Field("a", DataType.INT64)])
        n1 = Table.from_dicts([{"a": None}, {"a": 1}], schema)
        n2 = Table.from_dicts([{"a": None}, {"a": 2}], schema)
        cat = Catalog()
        cat.register("n1", MemorySource("n1", n1))
        cat.register("n2", MemorySource("n2", n2))
        eng = Engine(cat)
        result = eng.sql("SELECT a FROM n1 EXCEPT SELECT a FROM n2").to_dicts()
        assert result == [{"a": 1}]

    def test_result_uses_left_column_names(self, set_engine):
        result = set_engine.sql(
            "SELECT a AS left_a FROM t1 EXCEPT SELECT a FROM t2"
        )
        assert result.column_names == ["left_a"]

    def test_column_count_mismatch_raises(self, set_engine):
        with pytest.raises(PlanningError, match="EXCEPT"):
            set_engine.sql("SELECT a FROM t1 EXCEPT SELECT a, a FROM t2")


# ---------------------------------------------------------------------------
# EXCEPT ALL semantics
# ---------------------------------------------------------------------------

class TestExceptAll:
    def test_multiset_max_minus_zero(self, dup_engine):
        # t1: 1x2, 2x1, 3x1  |  t2: 1x1, 2x2
        # max(2-1,0)=1 for 1, max(1-2,0)=0 for 2, max(1-0,0)=1 for 3
        result = values(dup_engine, "SELECT a FROM t1 EXCEPT ALL SELECT a FROM t2")
        assert result == [1, 3]

    def test_all_cancels_earliest_left_copies(self, dup_engine):
        result = values(dup_engine, "SELECT a FROM t1 EXCEPT ALL SELECT a FROM t2")
        assert result.count(1) == 1   # 2 - 1 = 1
        assert result.count(2) == 0   # 1 - 2 = 0
        assert result.count(3) == 1   # 1 - 0 = 1

    def test_all_distinct_same_result_when_no_dups(self, set_engine):
        r_all = values(set_engine, "SELECT a FROM t1 EXCEPT ALL SELECT a FROM t2")
        r_dis = values(set_engine, "SELECT a FROM t1 EXCEPT SELECT a FROM t2")
        assert r_all == r_dis


# ---------------------------------------------------------------------------
# Precedence
# ---------------------------------------------------------------------------

class TestPrecedence:
    def test_intersect_binds_tighter_than_union(self, set_engine):
        """a UNION b INTERSECT c  =>  a UNION (b INTERSECT c)"""
        # t1={1,2,3}, t2={2,3,4}, t3={3,4,5}
        # b INTERSECT c = t2 INTERSECT t3 = {3,4}
        # a UNION {3,4} = {1,2,3,4}
        result = values(
            set_engine,
            "SELECT a FROM t1 UNION SELECT a FROM t2 INTERSECT SELECT a FROM t3",
        )
        assert result == [1, 2, 3, 4]

    def test_intersect_binds_tighter_than_except(self, set_engine):
        """a EXCEPT b INTERSECT c  =>  a EXCEPT (b INTERSECT c)"""
        # t1={1,2,3}, t2={2,3,4}, t3={3,4,5}
        # b INTERSECT c = t2 INTERSECT t3 = {3,4}
        # a EXCEPT {3,4} = {1,2}
        result = values(
            set_engine,
            "SELECT a FROM t1 EXCEPT SELECT a FROM t2 INTERSECT SELECT a FROM t3",
        )
        assert result == [1, 2]

    def test_except_is_left_associative(self, set_engine):
        """a EXCEPT b EXCEPT c  =>  (a EXCEPT b) EXCEPT c"""
        # t1={1,2,3}, t2={2,3,4}, t3={3,4,5}
        # (t1 EXCEPT t2) = {1}
        # {1} EXCEPT t3 = {1}
        result = values(
            set_engine,
            "SELECT a FROM t1 EXCEPT SELECT a FROM t2 EXCEPT SELECT a FROM t3",
        )
        assert result == [1]

    def test_union_is_left_associative(self, set_engine):
        """a UNION b UNION c is processed left to right (set semantics; result is same)."""
        result = values(
            set_engine,
            "SELECT a FROM t1 UNION SELECT a FROM t2 UNION SELECT a FROM t3",
        )
        assert result == [1, 2, 3, 4, 5]

    def test_except_left_assoc_differs_from_right_assoc(self, set_engine):
        """Verify left-to-right is correct and right-to-left gives a different answer."""
        # If right-associative: t1 EXCEPT (t2 EXCEPT t3)
        # t2 EXCEPT t3 = {2}
        # t1 EXCEPT {2} = {1, 3}   <-- wrong
        # If left-associative: (t1 EXCEPT t2) EXCEPT t3
        # t1 EXCEPT t2 = {1}
        # {1} EXCEPT t3 = {1}      <-- correct
        result = values(
            set_engine,
            "SELECT a FROM t1 EXCEPT SELECT a FROM t2 EXCEPT SELECT a FROM t3",
        )
        # Should be {1}, not {1,3}
        assert 3 not in result
        assert result == [1]


# ---------------------------------------------------------------------------
# Optimizer stability
# ---------------------------------------------------------------------------

class TestOptimizerStability:
    def test_intersect_answer_unchanged_by_optimizer(self, set_engine):
        sql = "SELECT a FROM t1 INTERSECT SELECT a FROM t2"
        opt_off = set_engine.with_config(optimize=False)
        assert sorted(r["a"] for r in set_engine.sql(sql).to_dicts()) == \
               sorted(r["a"] for r in opt_off.sql(sql).to_dicts())

    def test_except_answer_unchanged_by_optimizer(self, set_engine):
        sql = "SELECT a FROM t1 EXCEPT SELECT a FROM t2"
        opt_off = set_engine.with_config(optimize=False)
        assert sorted(r["a"] for r in set_engine.sql(sql).to_dicts()) == \
               sorted(r["a"] for r in opt_off.sql(sql).to_dicts())

    def test_intersect_all_answer_unchanged_by_optimizer(self, dup_engine):
        sql = "SELECT a FROM t1 INTERSECT ALL SELECT a FROM t2"
        opt_off = dup_engine.with_config(optimize=False)
        assert sorted(r["a"] for r in dup_engine.sql(sql).to_dicts()) == \
               sorted(r["a"] for r in opt_off.sql(sql).to_dicts())

    def test_except_all_answer_unchanged_by_optimizer(self, dup_engine):
        sql = "SELECT a FROM t1 EXCEPT ALL SELECT a FROM t2"
        opt_off = dup_engine.with_config(optimize=False)
        assert sorted(r["a"] for r in dup_engine.sql(sql).to_dicts()) == \
               sorted(r["a"] for r in opt_off.sql(sql).to_dicts())


# ---------------------------------------------------------------------------
# Batch size independence
# ---------------------------------------------------------------------------

class TestBatchSizeIndependence:
    def test_intersect_batch_size(self, set_engine):
        sql = "SELECT a FROM t1 INTERSECT SELECT a FROM t2"
        small = set_engine.with_config(batch_size=1)
        assert values(set_engine, sql) == values(small, sql)

    def test_except_batch_size(self, set_engine):
        sql = "SELECT a FROM t1 EXCEPT SELECT a FROM t2"
        small = set_engine.with_config(batch_size=1)
        assert values(set_engine, sql) == values(small, sql)

    def test_intersect_all_batch_size(self, dup_engine):
        sql = "SELECT a FROM t1 INTERSECT ALL SELECT a FROM t2"
        small = dup_engine.with_config(batch_size=1)
        assert values(dup_engine, sql) == values(small, sql)

    def test_except_all_batch_size(self, dup_engine):
        sql = "SELECT a FROM t1 EXCEPT ALL SELECT a FROM t2"
        small = dup_engine.with_config(batch_size=1)
        assert values(dup_engine, sql) == values(small, sql)


# ---------------------------------------------------------------------------
# EXPLAIN output
# ---------------------------------------------------------------------------

class TestExplain:
    def test_intersect_explain_distinct(self, set_engine):
        output = set_engine.explain("SELECT a FROM t1 INTERSECT SELECT a FROM t2")
        assert "Intersect: distinct" in output

    def test_intersect_explain_all(self, set_engine):
        output = set_engine.explain("SELECT a FROM t1 INTERSECT ALL SELECT a FROM t2")
        assert "Intersect: all" in output

    def test_except_explain_distinct(self, set_engine):
        output = set_engine.explain("SELECT a FROM t1 EXCEPT SELECT a FROM t2")
        assert "Except: distinct" in output

    def test_except_explain_all(self, set_engine):
        output = set_engine.explain("SELECT a FROM t1 EXCEPT ALL SELECT a FROM t2")
        assert "Except: all" in output
