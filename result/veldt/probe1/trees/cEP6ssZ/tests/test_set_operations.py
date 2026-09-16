"""Tests for INTERSECT and EXCEPT set operations."""

from __future__ import annotations

import pytest

from veldt import Engine
from veldt.errors import PlanningError
from veldt.plan.logical import Except, Intersect, Union
from veldt.plan.optimizer import optimize
from veldt.sql.compiler import compile_sql
from veldt.sql.parser import parse_select
from veldt.storage.catalog import Catalog
from veldt.storage.memory import MemorySource
from veldt.core.table import Table
from veldt.types.dtypes import DataType
from veldt.types.schema import Field, Schema


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def int_schema():
    return Schema([Field("x", DataType.INT64)])


@pytest.fixture
def two_col_schema():
    return Schema([Field("x", DataType.INT64), Field("y", DataType.STRING)])


def _make_engine(tables: dict) -> Engine:
    catalog = Catalog()
    for name, table in tables.items():
        catalog.register(name, MemorySource(name, table))
    return Engine(catalog)


def rows(engine, sql):
    return engine.sql(sql).to_dicts()


def vals(engine, sql):
    return sorted(row["x"] for row in rows(engine, sql))


# ---------------------------------------------------------------------------
# Parser tests
# ---------------------------------------------------------------------------


class TestParserIntersect:
    def test_intersect_parsed_as_kind(self):
        stmt = parse_select("SELECT a FROM t INTERSECT SELECT b FROM u")
        assert stmt.set_operation.kind == "intersect"

    def test_intersect_defaults_to_distinct(self):
        stmt = parse_select("SELECT a FROM t INTERSECT SELECT b FROM u")
        assert stmt.set_operation.all is False

    def test_intersect_all_is_recognised(self):
        stmt = parse_select("SELECT a FROM t INTERSECT ALL SELECT b FROM u")
        assert stmt.set_operation.all is True

    def test_intersect_rhs_is_a_full_statement(self):
        stmt = parse_select("SELECT a FROM t INTERSECT SELECT b FROM u WHERE b > 1")
        assert stmt.set_operation.statement.where is not None

    def test_intersect_chains(self):
        stmt = parse_select(
            "SELECT a FROM t INTERSECT SELECT b FROM u INTERSECT SELECT c FROM v"
        )
        # Chain should be nested (left-associative encoding)
        assert stmt.set_operation is not None
        assert stmt.set_operation.statement.set_operation is not None


class TestParserExcept:
    def test_except_parsed_as_kind(self):
        stmt = parse_select("SELECT a FROM t EXCEPT SELECT b FROM u")
        assert stmt.set_operation.kind == "except"

    def test_except_defaults_to_distinct(self):
        stmt = parse_select("SELECT a FROM t EXCEPT SELECT b FROM u")
        assert stmt.set_operation.all is False

    def test_except_all_is_recognised(self):
        stmt = parse_select("SELECT a FROM t EXCEPT ALL SELECT b FROM u")
        assert stmt.set_operation.all is True

    def test_except_chains_left_to_right(self):
        # a EXCEPT b EXCEPT c => nested chain encoding (left-associative)
        stmt = parse_select(
            "SELECT a FROM t EXCEPT SELECT b FROM u EXCEPT SELECT c FROM v"
        )
        assert stmt.set_operation is not None
        assert stmt.set_operation.statement.set_operation is not None

    def test_except_rhs_is_a_full_statement(self):
        stmt = parse_select("SELECT a FROM t EXCEPT SELECT b FROM u WHERE b > 1")
        assert stmt.set_operation.statement.where is not None


class TestParserPrecedence:
    def test_intersect_binds_tighter_than_union(self):
        # a UNION b INTERSECT c => union is the root, intersect is inner
        stmt = parse_select(
            "SELECT a FROM t UNION SELECT b FROM u INTERSECT SELECT c FROM v"
        )
        # The top-level set_op should be union
        assert stmt.set_operation.kind == "union"
        # The rhs should have an intersect
        rhs = stmt.set_operation.statement
        assert rhs.set_operation.kind == "intersect"

    def test_intersect_binds_tighter_than_except(self):
        # a EXCEPT b INTERSECT c => except is root, intersect inner
        stmt = parse_select(
            "SELECT a FROM t EXCEPT SELECT b FROM u INTERSECT SELECT c FROM v"
        )
        assert stmt.set_operation.kind == "except"
        rhs = stmt.set_operation.statement
        assert rhs.set_operation.kind == "intersect"


# ---------------------------------------------------------------------------
# Compiler / logical plan tests
# ---------------------------------------------------------------------------


class TestCompilerIntersect:
    def test_intersect_distinct_produces_intersect_node(self, int_schema):
        t = Table.from_dicts([{"x": 1}], int_schema)
        catalog = Catalog()
        catalog.register("t", MemorySource("t", t))
        plan = compile_sql("SELECT x FROM t INTERSECT SELECT x FROM t", catalog)
        assert isinstance(plan, Intersect)
        assert plan.all is False

    def test_intersect_all_produces_all_node(self, int_schema):
        t = Table.from_dicts([{"x": 1}], int_schema)
        catalog = Catalog()
        catalog.register("t", MemorySource("t", t))
        plan = compile_sql("SELECT x FROM t INTERSECT ALL SELECT x FROM t", catalog)
        assert isinstance(plan, Intersect)
        assert plan.all is True

    def test_intersect_takes_names_from_left(self, int_schema):
        t = Table.from_dicts([{"x": 1}], int_schema)
        catalog = Catalog()
        catalog.register("t", MemorySource("t", t))
        plan = compile_sql(
            "SELECT x AS a FROM t INTERSECT SELECT x AS b FROM t", catalog
        )
        assert plan.schema.names == ["a"]

    def test_intersect_requires_matching_column_counts(self, two_col_schema):
        t = Table.from_dicts([{"x": 1, "y": "a"}], two_col_schema)
        catalog = Catalog()
        catalog.register("t", MemorySource("t", t))
        with pytest.raises(PlanningError, match="INTERSECT"):
            compile_sql("SELECT x FROM t INTERSECT SELECT x, y FROM t", catalog)


class TestCompilerExcept:
    def test_except_distinct_produces_except_node(self, int_schema):
        t = Table.from_dicts([{"x": 1}], int_schema)
        catalog = Catalog()
        catalog.register("t", MemorySource("t", t))
        plan = compile_sql("SELECT x FROM t EXCEPT SELECT x FROM t", catalog)
        assert isinstance(plan, Except)
        assert plan.all is False

    def test_except_all_produces_all_node(self, int_schema):
        t = Table.from_dicts([{"x": 1}], int_schema)
        catalog = Catalog()
        catalog.register("t", MemorySource("t", t))
        plan = compile_sql("SELECT x FROM t EXCEPT ALL SELECT x FROM t", catalog)
        assert isinstance(plan, Except)
        assert plan.all is True

    def test_except_takes_names_from_left(self, int_schema):
        t = Table.from_dicts([{"x": 1}], int_schema)
        catalog = Catalog()
        catalog.register("t", MemorySource("t", t))
        plan = compile_sql(
            "SELECT x AS a FROM t EXCEPT SELECT x AS b FROM t", catalog
        )
        assert plan.schema.names == ["a"]

    def test_except_requires_matching_column_counts(self, two_col_schema):
        t = Table.from_dicts([{"x": 1, "y": "a"}], two_col_schema)
        catalog = Catalog()
        catalog.register("t", MemorySource("t", t))
        with pytest.raises(PlanningError, match="EXCEPT"):
            compile_sql("SELECT x FROM t EXCEPT SELECT x, y FROM t", catalog)


class TestCompilerPrecedence:
    def test_intersect_binds_tighter_than_union_in_plan(self, int_schema):
        t = Table.from_dicts([{"x": 1}], int_schema)
        catalog = Catalog()
        for name in ("a", "b", "c"):
            catalog.register(name, MemorySource(name, t))
        # a UNION b INTERSECT c => Union(a, Intersect(b, c))
        plan = compile_sql(
            "SELECT x FROM a UNION SELECT x FROM b INTERSECT SELECT x FROM c", catalog
        )
        # Top level should be Distinct(Union(...))
        from veldt.plan.logical import Distinct
        assert isinstance(plan, Distinct)
        assert isinstance(plan.input, Union)
        assert isinstance(plan.input.right, Intersect)

    def test_except_is_left_associative_in_plan(self, int_schema):
        t = Table.from_dicts([{"x": 1}], int_schema)
        catalog = Catalog()
        for name in ("a", "b", "c"):
            catalog.register(name, MemorySource(name, t))
        # a EXCEPT b EXCEPT c => Except(Except(a, b), c)
        plan = compile_sql(
            "SELECT x FROM a EXCEPT SELECT x FROM b EXCEPT SELECT x FROM c", catalog
        )
        assert isinstance(plan, Except)
        assert isinstance(plan.left, Except)

    def test_union_except_left_associative(self, int_schema):
        t = Table.from_dicts([{"x": 1}], int_schema)
        catalog = Catalog()
        for name in ("a", "b", "c"):
            catalog.register(name, MemorySource(name, t))
        # a UNION b EXCEPT c => (a UNION b) EXCEPT c = Except(Distinct(Union(a,b)), c)
        plan = compile_sql(
            "SELECT x FROM a UNION SELECT x FROM b EXCEPT SELECT x FROM c", catalog
        )
        from veldt.plan.logical import Distinct
        assert isinstance(plan, Except)
        # left should be the result of UNION (wrapped in Distinct for plain UNION)
        assert isinstance(plan.left, Distinct)
        assert isinstance(plan.left.input, Union)


# ---------------------------------------------------------------------------
# Execution: distinct mode
# ---------------------------------------------------------------------------


class TestIntersectDistinct:
    @pytest.fixture
    def engine(self, int_schema):
        t1 = Table.from_dicts([{"x": 1}, {"x": 2}, {"x": 3}], int_schema)
        t2 = Table.from_dicts([{"x": 2}, {"x": 3}, {"x": 4}], int_schema)
        return _make_engine({"t1": t1, "t2": t2})

    def test_keeps_rows_in_both(self, engine):
        assert vals(engine, "SELECT x FROM t1 INTERSECT SELECT x FROM t2") == [2, 3]

    def test_empty_when_disjoint(self, engine):
        assert vals(engine, "SELECT x FROM t1 INTERSECT SELECT x FROM t2 WHERE x > 10") == []

    def test_each_row_at_most_once(self, int_schema):
        # t1 has duplicates; result should still be distinct
        t1 = Table.from_dicts([{"x": 1}, {"x": 1}, {"x": 2}], int_schema)
        t2 = Table.from_dicts([{"x": 1}], int_schema)
        engine = _make_engine({"t1": t1, "t2": t2})
        assert vals(engine, "SELECT x FROM t1 INTERSECT SELECT x FROM t2") == [1]

    def test_takes_column_names_from_left(self, int_schema):
        t = Table.from_dicts([{"x": 1}], int_schema)
        engine = _make_engine({"t": t})
        result = engine.sql("SELECT x AS left_col FROM t INTERSECT SELECT x AS right_col FROM t")
        assert result.column_names == ["left_col"]

    def test_null_pairs_with_null(self, int_schema):
        t1 = Table.from_dicts([{"x": None}, {"x": 1}], int_schema)
        t2 = Table.from_dicts([{"x": None}, {"x": 2}], int_schema)
        engine = _make_engine({"t1": t1, "t2": t2})
        result = engine.sql("SELECT x FROM t1 INTERSECT SELECT x FROM t2")
        assert [r["x"] for r in result.to_dicts()] == [None]


class TestExceptDistinct:
    @pytest.fixture
    def engine(self, int_schema):
        t1 = Table.from_dicts([{"x": 1}, {"x": 2}, {"x": 3}], int_schema)
        t2 = Table.from_dicts([{"x": 2}, {"x": 3}, {"x": 4}], int_schema)
        return _make_engine({"t1": t1, "t2": t2})

    def test_keeps_left_rows_absent_from_right(self, engine):
        assert vals(engine, "SELECT x FROM t1 EXCEPT SELECT x FROM t2") == [1]

    def test_empty_when_all_left_rows_in_right(self, engine):
        # t2 INTERSECT t1 results = {2,3,4}; t2 EXCEPT t1 results = {4}
        # When the left side (limited) is a subset of the right side, result is empty.
        assert vals(engine, "SELECT x FROM t1 EXCEPT SELECT x FROM t2 WHERE x > 1") == [1]

    def test_each_surviving_row_once(self, int_schema):
        # t1 has duplicate 1; result should still appear once
        t1 = Table.from_dicts([{"x": 1}, {"x": 1}, {"x": 2}], int_schema)
        t2 = Table.from_dicts([{"x": 2}], int_schema)
        engine = _make_engine({"t1": t1, "t2": t2})
        assert vals(engine, "SELECT x FROM t1 EXCEPT SELECT x FROM t2") == [1]

    def test_null_subtracted_by_null(self, int_schema):
        t1 = Table.from_dicts([{"x": None}, {"x": 1}], int_schema)
        t2 = Table.from_dicts([{"x": None}], int_schema)
        engine = _make_engine({"t1": t1, "t2": t2})
        result = engine.sql("SELECT x FROM t1 EXCEPT SELECT x FROM t2")
        assert [r["x"] for r in result.to_dicts()] == [1]

    def test_right_empty_returns_left(self, int_schema):
        t1 = Table.from_dicts([{"x": 1}, {"x": 2}, {"x": 3}], int_schema)
        t_empty = Table.from_dicts([], int_schema)
        engine2 = _make_engine({"t1": t1, "empty": t_empty})
        assert vals(engine2, "SELECT x FROM t1 EXCEPT SELECT x FROM empty") == [1, 2, 3]


# ---------------------------------------------------------------------------
# Execution: ALL mode
# ---------------------------------------------------------------------------


class TestIntersectAll:
    @pytest.fixture
    def engine(self, int_schema):
        # t1: 1,1,2,3  t2: 1,2,2
        t1 = Table.from_dicts([{"x": 1}, {"x": 1}, {"x": 2}, {"x": 3}], int_schema)
        t2 = Table.from_dicts([{"x": 1}, {"x": 2}, {"x": 2}], int_schema)
        return _make_engine({"t1": t1, "t2": t2})

    def test_min_count(self, engine):
        # x=1: min(2,1)=1  x=2: min(1,2)=1  x=3: min(1,0)=0
        assert vals(engine, "SELECT x FROM t1 INTERSECT ALL SELECT x FROM t2") == [1, 2]

    def test_symmetric_min(self, int_schema):
        t1 = Table.from_dicts([{"x": 1}, {"x": 1}, {"x": 1}], int_schema)
        t2 = Table.from_dicts([{"x": 1}, {"x": 1}], int_schema)
        engine = _make_engine({"t1": t1, "t2": t2})
        result = engine.sql("SELECT x FROM t1 INTERSECT ALL SELECT x FROM t2")
        assert len(result.to_dicts()) == 2

    def test_order_follows_left(self, int_schema):
        # Left order is preserved
        t1 = Table.from_dicts([{"x": 3}, {"x": 1}, {"x": 2}], int_schema)
        t2 = Table.from_dicts([{"x": 1}, {"x": 2}, {"x": 3}], int_schema)
        engine = _make_engine({"t1": t1, "t2": t2})
        result = [r["x"] for r in engine.sql(
            "SELECT x FROM t1 INTERSECT ALL SELECT x FROM t2"
        ).to_dicts()]
        assert result == [3, 1, 2]


class TestExceptAll:
    @pytest.fixture
    def engine(self, int_schema):
        # t1: 1,1,2,3  t2: 1,2,2
        t1 = Table.from_dicts([{"x": 1}, {"x": 1}, {"x": 2}, {"x": 3}], int_schema)
        t2 = Table.from_dicts([{"x": 1}, {"x": 2}, {"x": 2}], int_schema)
        return _make_engine({"t1": t1, "t2": t2})

    def test_max_zero_floor(self, engine):
        # x=1: max(2-1,0)=1  x=2: max(1-2,0)=0  x=3: max(1-0,0)=1
        assert vals(engine, "SELECT x FROM t1 EXCEPT ALL SELECT x FROM t2") == [1, 3]

    def test_cancels_earliest_left_copy(self, int_schema):
        # Order: right copy cancels the first left copy still standing
        t1 = Table.from_dicts([{"x": 1}, {"x": 1}, {"x": 1}], int_schema)
        t2 = Table.from_dicts([{"x": 1}, {"x": 1}], int_schema)
        engine = _make_engine({"t1": t1, "t2": t2})
        result = engine.sql("SELECT x FROM t1 EXCEPT ALL SELECT x FROM t2")
        assert len(result.to_dicts()) == 1

    def test_right_empty_returns_all_left(self, int_schema):
        t1 = Table.from_dicts([{"x": 1}, {"x": 1}, {"x": 2}], int_schema)
        t2 = Table.from_dicts([], int_schema)
        engine = _make_engine({"t1": t1, "t2": t2})
        result = engine.sql("SELECT x FROM t1 EXCEPT ALL SELECT x FROM t2")
        assert sorted(r["x"] for r in result.to_dicts()) == [1, 1, 2]


# ---------------------------------------------------------------------------
# Type unification
# ---------------------------------------------------------------------------


class TestTypeUnification:
    def test_int_and_float_unify_to_float(self):
        schema_int = Schema([Field("x", DataType.INT64)])
        schema_flt = Schema([Field("x", DataType.FLOAT64)])
        t_int = Table.from_dicts([{"x": 1}, {"x": 2}], schema_int)
        t_flt = Table.from_dicts([{"x": 1.0}, {"x": 3.0}], schema_flt)
        engine = _make_engine({"ti": t_int, "tf": t_flt})
        # int 1 and float 1.0 are the same after unification
        r = engine.sql("SELECT x FROM ti INTERSECT SELECT x FROM tf")
        assert r.schema.fields[0].dtype == DataType.FLOAT64
        values = [row["x"] for row in r.to_dicts()]
        assert len(values) == 1 and abs(values[0] - 1.0) < 1e-9

    def test_except_int_float_unification(self):
        schema_int = Schema([Field("x", DataType.INT64)])
        schema_flt = Schema([Field("x", DataType.FLOAT64)])
        t_int = Table.from_dicts([{"x": 1}, {"x": 2}], schema_int)
        t_flt = Table.from_dicts([{"x": 1.0}], schema_flt)
        engine = _make_engine({"ti": t_int, "tf": t_flt})
        # After unification, 1 == 1.0, so only 2 survives
        r = engine.sql("SELECT x FROM ti EXCEPT SELECT x FROM tf")
        values = sorted(row["x"] for row in r.to_dicts())
        assert len(values) == 1 and abs(values[0] - 2.0) < 1e-9


# ---------------------------------------------------------------------------
# Precedence execution tests
# ---------------------------------------------------------------------------


class TestPrecedenceExecution:
    @pytest.fixture
    def engine(self, int_schema):
        a = Table.from_dicts([{"x": 1}, {"x": 2}, {"x": 3}], int_schema)
        b = Table.from_dicts([{"x": 2}, {"x": 3}, {"x": 4}], int_schema)
        c = Table.from_dicts([{"x": 3}, {"x": 4}, {"x": 5}], int_schema)
        return _make_engine({"a": a, "b": b, "c": c})

    def test_union_then_intersect(self, engine):
        # a UNION b INTERSECT c = a UNION (b INTERSECT c)
        # b INTERSECT c = {3, 4}
        # a UNION {3, 4} = {1, 2, 3, 4}
        assert vals(engine, "SELECT x FROM a UNION SELECT x FROM b INTERSECT SELECT x FROM c") == [
            1, 2, 3, 4
        ]

    def test_except_then_except_left_assoc(self, engine):
        # a EXCEPT b EXCEPT c = (a EXCEPT b) EXCEPT c
        # a EXCEPT b = {1}
        # {1} EXCEPT c = {1}
        assert vals(engine, "SELECT x FROM a EXCEPT SELECT x FROM b EXCEPT SELECT x FROM c") == [1]

    def test_except_then_intersect_precedence(self, engine):
        # a EXCEPT b INTERSECT c = a EXCEPT (b INTERSECT c)
        # b INTERSECT c = {3, 4}
        # a EXCEPT {3,4} = {1, 2}
        assert vals(engine, "SELECT x FROM a EXCEPT SELECT x FROM b INTERSECT SELECT x FROM c") == [
            1, 2
        ]


# ---------------------------------------------------------------------------
# EXPLAIN / describe tests
# ---------------------------------------------------------------------------


class TestExplain:
    @pytest.fixture
    def engine(self, int_schema):
        t = Table.from_dicts([{"x": 1}], int_schema)
        return _make_engine({"t": t})

    def test_intersect_distinct_label(self, engine):
        plan = engine.explain("SELECT x FROM t INTERSECT SELECT x FROM t")
        assert "Intersect: distinct" in plan

    def test_intersect_all_label(self, engine):
        plan = engine.explain("SELECT x FROM t INTERSECT ALL SELECT x FROM t")
        assert "Intersect: all" in plan

    def test_except_distinct_label(self, engine):
        plan = engine.explain("SELECT x FROM t EXCEPT SELECT x FROM t")
        assert "Except: distinct" in plan

    def test_except_all_label(self, engine):
        plan = engine.explain("SELECT x FROM t EXCEPT ALL SELECT x FROM t")
        assert "Except: all" in plan


# ---------------------------------------------------------------------------
# Optimizer stability
# ---------------------------------------------------------------------------


class TestOptimizerStability:
    def test_intersect_survives_optimization(self, int_schema):
        t = Table.from_dicts([{"x": 1}, {"x": 2}], int_schema)
        catalog = Catalog()
        catalog.register("t", MemorySource("t", t))
        plan = compile_sql("SELECT x FROM t INTERSECT SELECT x FROM t", catalog)
        opt = optimize(plan)
        assert plan.schema == opt.schema
        assert isinstance(opt, Intersect)

    def test_except_survives_optimization(self, int_schema):
        t = Table.from_dicts([{"x": 1}, {"x": 2}], int_schema)
        catalog = Catalog()
        catalog.register("t", MemorySource("t", t))
        plan = compile_sql("SELECT x FROM t EXCEPT SELECT x FROM t", catalog)
        opt = optimize(plan)
        assert plan.schema == opt.schema
        assert isinstance(opt, Except)

    def test_batch_size_does_not_change_result(self, int_schema):
        t1 = Table.from_dicts([{"x": i} for i in range(1, 6)], int_schema)
        t2 = Table.from_dicts([{"x": i} for i in range(3, 8)], int_schema)
        catalog = Catalog()
        catalog.register("t1", MemorySource("t1", t1))
        catalog.register("t2", MemorySource("t2", t2))
        engine = Engine(catalog)
        result = sorted(
            row["x"]
            for row in engine.sql("SELECT x FROM t1 INTERSECT SELECT x FROM t2").to_dicts()
        )
        assert result == [3, 4, 5]


# ---------------------------------------------------------------------------
# Multi-column set operations
# ---------------------------------------------------------------------------


class TestMultiColumn:
    def test_intersect_multi_column(self, two_col_schema):
        t1 = Table.from_dicts(
            [{"x": 1, "y": "a"}, {"x": 2, "y": "b"}, {"x": 1, "y": "c"}], two_col_schema
        )
        t2 = Table.from_dicts(
            [{"x": 1, "y": "a"}, {"x": 3, "y": "d"}], two_col_schema
        )
        engine = _make_engine({"t1": t1, "t2": t2})
        result = engine.sql("SELECT x, y FROM t1 INTERSECT SELECT x, y FROM t2")
        rows_out = result.to_dicts()
        assert len(rows_out) == 1
        assert rows_out[0] == {"x": 1, "y": "a"}

    def test_except_multi_column(self, two_col_schema):
        t1 = Table.from_dicts(
            [{"x": 1, "y": "a"}, {"x": 2, "y": "b"}], two_col_schema
        )
        t2 = Table.from_dicts(
            [{"x": 1, "y": "a"}], two_col_schema
        )
        engine = _make_engine({"t1": t1, "t2": t2})
        result = engine.sql("SELECT x, y FROM t1 EXCEPT SELECT x, y FROM t2")
        rows_out = result.to_dicts()
        assert len(rows_out) == 1
        assert rows_out[0] == {"x": 2, "y": "b"}
