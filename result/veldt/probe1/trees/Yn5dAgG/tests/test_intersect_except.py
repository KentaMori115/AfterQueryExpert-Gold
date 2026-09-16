"""Tests for INTERSECT and EXCEPT set operations."""

from __future__ import annotations

import pytest

from veldt import Engine
from veldt.core.table import Table
from veldt.errors import PlanningError
from veldt.execution.operators.intersect import ExceptOperator, IntersectOperator
from veldt.execution.context import ExecutionContext
from veldt.plan.logical import Except, Intersect
from veldt.sql.compiler import compile_sql
from veldt.sql.parser import parse_select
from veldt.storage.catalog import Catalog
from veldt.storage.memory import MemorySource
from veldt.types.dtypes import DataType
from veldt.types.schema import Field, Schema


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

INT_SCHEMA = Schema([Field("x", DataType.INT64)])
FLOAT_SCHEMA = Schema([Field("x", DataType.FLOAT64)])


def make_catalog(**tables):
    """Build a catalog from name → list-of-dicts (or Table) mappings."""
    catalog = Catalog()
    for name, rows in tables.items():
        if isinstance(rows, Table):
            table = rows
        else:
            table = Table.from_dicts(rows)
        catalog.register(name, MemorySource(name, table))
    return catalog


def make_engine(**tables):
    """Build a small engine from name → list-of-dicts (or Table) mappings."""
    return Engine(make_catalog(**tables))


def rows(engine, sql):
    return engine.sql(sql).to_dicts()


# ---------------------------------------------------------------------------
# Parser
# ---------------------------------------------------------------------------

class TestParser:
    def test_intersect_is_recognised(self):
        stmt = parse_select("SELECT a FROM t INTERSECT SELECT b FROM u")
        assert stmt.set_operation.kind == "intersect"
        assert stmt.set_operation.all is False

    def test_intersect_all_is_recognised(self):
        stmt = parse_select("SELECT a FROM t INTERSECT ALL SELECT b FROM u")
        assert stmt.set_operation.kind == "intersect"
        assert stmt.set_operation.all is True

    def test_except_is_recognised(self):
        stmt = parse_select("SELECT a FROM t EXCEPT SELECT b FROM u")
        assert stmt.set_operation.kind == "except"
        assert stmt.set_operation.all is False

    def test_except_all_is_recognised(self):
        stmt = parse_select("SELECT a FROM t EXCEPT ALL SELECT b FROM u")
        assert stmt.set_operation.kind == "except"
        assert stmt.set_operation.all is True

    def test_chain_is_parsed(self):
        stmt = parse_select(
            "SELECT a FROM t UNION SELECT b FROM u INTERSECT SELECT c FROM v"
        )
        assert stmt.set_operation.kind == "union"
        assert stmt.set_operation.statement.set_operation.kind == "intersect"


# ---------------------------------------------------------------------------
# Logical plan
# ---------------------------------------------------------------------------

class TestLogicalNodes:
    def setup_method(self):
        schema = INT_SCHEMA
        source = MemorySource("t", Table.from_dicts([{"x": 1}], schema))
        from veldt.plan.logical import Scan, Project
        from veldt.expr.ast import ColumnRef
        scan = Scan(source, "t")
        self.left = Project(scan, (ColumnRef("x"),))
        self.right = Project(scan, (ColumnRef("x"),))

    def test_intersect_schema_uses_left_names(self):
        node = Intersect(self.left, self.right)
        assert node.schema.names == ["x"]

    def test_intersect_all_describes_correctly(self):
        assert Intersect(self.left, self.right, all=True).describe() == "Intersect: all"

    def test_intersect_distinct_describes_correctly(self):
        assert Intersect(self.left, self.right, all=False).describe() == "Intersect: distinct"

    def test_except_schema_uses_left_names(self):
        node = Except(self.left, self.right)
        assert node.schema.names == ["x"]

    def test_except_all_describes_correctly(self):
        assert Except(self.left, self.right, all=True).describe() == "Except: all"

    def test_except_distinct_describes_correctly(self):
        assert Except(self.left, self.right, all=False).describe() == "Except: distinct"

    def test_intersect_with_children(self):
        node = Intersect(self.left, self.right)
        rebuilt = node.with_children([self.right, self.left])
        assert rebuilt.left is self.right
        assert rebuilt.right is self.left

    def test_except_with_children(self):
        node = Except(self.left, self.right)
        rebuilt = node.with_children([self.right, self.left])
        assert rebuilt.left is self.right
        assert rebuilt.right is self.left


# ---------------------------------------------------------------------------
# Precedence and associativity
# ---------------------------------------------------------------------------

class TestPrecedence:
    def setup_method(self):
        schema = INT_SCHEMA
        source = MemorySource("t", Table.from_dicts([{"x": 1}], schema))
        self.catalog = Catalog()
        self.catalog.register("t", source)

    def _compile(self, sql):
        return compile_sql(sql, self.catalog)

    def test_intersect_binds_tighter_than_union(self):
        # a UNION b INTERSECT c  →  Union(a, Intersect(b, c))
        plan = self._compile(
            "SELECT x FROM t UNION SELECT x FROM t INTERSECT SELECT x FROM t"
        )
        # Top is Distinct wrapping Union; Union's right child should be Intersect
        from veldt.plan.logical import Distinct, Union
        assert isinstance(plan, Distinct)
        assert isinstance(plan.input, Union)
        assert isinstance(plan.input.right, Intersect)

    def test_intersect_binds_tighter_than_except(self):
        # a EXCEPT b INTERSECT c  →  Except(a, Intersect(b, c))
        plan = self._compile(
            "SELECT x FROM t EXCEPT SELECT x FROM t INTERSECT SELECT x FROM t"
        )
        assert isinstance(plan, Except)
        assert isinstance(plan.right, Intersect)

    def test_except_is_left_associative(self):
        # a EXCEPT b EXCEPT c  →  Except(Except(a, b), c)
        plan = self._compile(
            "SELECT x FROM t EXCEPT SELECT x FROM t EXCEPT SELECT x FROM t"
        )
        assert isinstance(plan, Except)
        assert isinstance(plan.left, Except)

    def test_intersect_is_left_associative(self):
        # a INTERSECT b INTERSECT c  →  Intersect(Intersect(a, b), c)
        plan = self._compile(
            "SELECT x FROM t INTERSECT SELECT x FROM t INTERSECT SELECT x FROM t"
        )
        assert isinstance(plan, Intersect)
        assert isinstance(plan.left, Intersect)

    def test_union_and_except_are_left_associative(self):
        # a UNION b EXCEPT c  →  Except(Union(a,b), c)
        plan = self._compile(
            "SELECT x FROM t UNION SELECT x FROM t EXCEPT SELECT x FROM t"
        )
        assert isinstance(plan, Except)
        from veldt.plan.logical import Distinct, Union
        # The left side should be the Union (possibly wrapped in Distinct)
        left = plan.left
        assert isinstance(left, Distinct) or isinstance(left, Union)


# ---------------------------------------------------------------------------
# Column count error
# ---------------------------------------------------------------------------

class TestColumnCountError:
    def setup_method(self):
        self.engine = make_engine(
            t1=[{"x": 1}],
            t2=[{"x": 1, "y": 2}],
        )

    def test_intersect_requires_matching_widths(self):
        with pytest.raises(PlanningError, match="INTERSECT"):
            self.engine.sql("SELECT x FROM t1 INTERSECT SELECT x, y FROM t2")

    def test_except_requires_matching_widths(self):
        with pytest.raises(PlanningError, match="EXCEPT"):
            self.engine.sql("SELECT x FROM t1 EXCEPT SELECT x, y FROM t2")


# ---------------------------------------------------------------------------
# INTERSECT DISTINCT semantics
# ---------------------------------------------------------------------------

class TestIntersectDistinct:
    def setup_method(self):
        self.engine = make_engine(
            t1=[{"x": 1}, {"x": 2}, {"x": 3}],
            t2=[{"x": 2}, {"x": 3}, {"x": 4}],
        )

    def test_keeps_common_rows(self):
        result = rows(self.engine, "SELECT x FROM t1 INTERSECT SELECT x FROM t2")
        assert sorted(r["x"] for r in result) == [2, 3]

    def test_each_surviving_row_appears_once(self):
        # t1 has x=1,2; same values duplicated on both sides
        engine2 = make_engine(
            a=[{"x": 1}, {"x": 1}, {"x": 2}],
            b=[{"x": 1}, {"x": 2}, {"x": 2}],
        )
        result = rows(engine2, "SELECT x FROM a INTERSECT SELECT x FROM b")
        # each of 1 and 2 appears exactly once
        assert sorted(r["x"] for r in result) == [1, 2]

    def test_left_names_are_used(self):
        result = self.engine.sql(
            "SELECT x AS left_val FROM t1 INTERSECT SELECT x FROM t2"
        )
        assert result.column_names == ["left_val"]

    def test_intersect_with_empty_right_yields_nothing(self):
        engine2 = make_engine(
            a=Table.from_dicts([{"x": 1}, {"x": 2}], INT_SCHEMA),
            b=Table.from_dicts([], INT_SCHEMA),
        )
        result = rows(engine2, "SELECT x FROM a INTERSECT SELECT x FROM b")
        assert result == []

    def test_intersect_with_empty_left_yields_nothing(self):
        engine2 = make_engine(
            a=Table.from_dicts([], INT_SCHEMA),
            b=Table.from_dicts([{"x": 1}, {"x": 2}], INT_SCHEMA),
        )
        result = rows(engine2, "SELECT x FROM a INTERSECT SELECT x FROM b")
        assert result == []


# ---------------------------------------------------------------------------
# INTERSECT ALL semantics
# ---------------------------------------------------------------------------

class TestIntersectAll:
    def test_min_of_counts(self):
        # lhs: 1x1, 2x2, 3x1  rhs: 2x3, 3x1  →  2x2, 3x1
        engine = make_engine(
            lhs=[{"x": 1}, {"x": 2}, {"x": 2}, {"x": 3}],
            rhs=[{"x": 2}, {"x": 2}, {"x": 2}, {"x": 3}],
        )
        result = rows(engine, "SELECT x FROM lhs INTERSECT ALL SELECT x FROM rhs")
        assert sorted(r["x"] for r in result) == [2, 2, 3]

    def test_zero_count_excluded(self):
        # rhs has no 1s, so 1 is excluded
        engine = make_engine(
            lhs=[{"x": 1}, {"x": 2}],
            rhs=[{"x": 2}, {"x": 3}],
        )
        result = rows(engine, "SELECT x FROM lhs INTERSECT ALL SELECT x FROM rhs")
        assert [r["x"] for r in result] == [2]

    def test_left_order_preserved(self):
        engine = make_engine(
            lhs=[{"x": 3}, {"x": 1}, {"x": 2}],
            rhs=[{"x": 1}, {"x": 2}, {"x": 3}],
        )
        result = rows(engine, "SELECT x FROM lhs INTERSECT ALL SELECT x FROM rhs")
        assert [r["x"] for r in result] == [3, 1, 2]


# ---------------------------------------------------------------------------
# EXCEPT DISTINCT semantics
# ---------------------------------------------------------------------------

class TestExceptDistinct:
    def setup_method(self):
        self.engine = make_engine(
            t1=[{"x": 1}, {"x": 2}, {"x": 3}],
            t2=[{"x": 2}, {"x": 3}, {"x": 4}],
        )

    def test_keeps_left_minus_right(self):
        result = rows(self.engine, "SELECT x FROM t1 EXCEPT SELECT x FROM t2")
        assert [r["x"] for r in result] == [1]

    def test_empty_when_right_contains_all_left(self):
        result = rows(self.engine, "SELECT x FROM t1 EXCEPT SELECT x FROM t1")
        assert result == []

    def test_each_surviving_row_appears_once(self):
        engine2 = make_engine(
            a=[{"x": 1}, {"x": 1}, {"x": 2}],
            b=[{"x": 2}],
        )
        result = rows(engine2, "SELECT x FROM a EXCEPT SELECT x FROM b")
        # x=1 survives; should appear once despite two copies in left
        assert [r["x"] for r in result] == [1]

    def test_left_names_are_used(self):
        result = self.engine.sql(
            "SELECT x AS mine FROM t1 EXCEPT SELECT x FROM t2"
        )
        assert result.column_names == ["mine"]

    def test_except_with_empty_right_yields_all_distinct_left(self):
        engine2 = make_engine(
            a=[{"x": 1}, {"x": 1}, {"x": 2}],
            b=Table.from_dicts([], INT_SCHEMA),
        )
        result = rows(engine2, "SELECT x FROM a EXCEPT SELECT x FROM b")
        assert sorted(r["x"] for r in result) == [1, 2]

    def test_except_with_empty_left_yields_nothing(self):
        engine2 = make_engine(
            a=Table.from_dicts([], INT_SCHEMA),
            b=[{"x": 1}],
        )
        result = rows(engine2, "SELECT x FROM a EXCEPT SELECT x FROM b")
        assert result == []


# ---------------------------------------------------------------------------
# EXCEPT ALL semantics
# ---------------------------------------------------------------------------

class TestExceptAll:
    def test_left_minus_right_counts(self):
        # lhs: 1x1, 2x2, 3x1  rhs: 2x3, 3x1
        # => 1: max(1-0,0)=1, 2: max(2-3,0)=0, 3: max(1-1,0)=0
        engine = make_engine(
            lhs=[{"x": 1}, {"x": 2}, {"x": 2}, {"x": 3}],
            rhs=[{"x": 2}, {"x": 2}, {"x": 2}, {"x": 3}],
        )
        result = rows(engine, "SELECT x FROM lhs EXCEPT ALL SELECT x FROM rhs")
        assert [r["x"] for r in result] == [1]

    def test_right_cancels_earliest_left_copies(self):
        # lhs order [1,2,2,1], rhs has one 1 → one 1 cancelled (earliest)
        engine = make_engine(
            lhs=[{"x": 1}, {"x": 2}, {"x": 2}, {"x": 1}],
            rhs=[{"x": 1}],
        )
        result = rows(engine, "SELECT x FROM lhs EXCEPT ALL SELECT x FROM rhs")
        # First x=1 cancelled; remaining: [2, 2, 1]
        assert [r["x"] for r in result] == [2, 2, 1]

    def test_left_order_preserved(self):
        engine = make_engine(
            lhs=[{"x": 3}, {"x": 1}, {"x": 2}],
            rhs=[{"x": 1}],
        )
        result = rows(engine, "SELECT x FROM lhs EXCEPT ALL SELECT x FROM rhs")
        assert [r["x"] for r in result] == [3, 2]


# ---------------------------------------------------------------------------
# NULL behaviour
# ---------------------------------------------------------------------------

class TestNullBehaviour:
    def test_two_nulls_pair_in_intersect(self):
        engine = make_engine(
            a=[{"x": None}, {"x": 1}],
            b=[{"x": None}, {"x": 2}],
        )
        result = rows(engine, "SELECT x FROM a INTERSECT SELECT x FROM b")
        assert result == [{"x": None}]

    def test_null_excluded_by_except(self):
        engine = make_engine(
            a=[{"x": None}, {"x": 1}],
            b=[{"x": None}],
        )
        result = rows(engine, "SELECT x FROM a EXCEPT SELECT x FROM b")
        assert result == [{"x": 1}]

    def test_null_kept_by_except_when_not_on_right(self):
        engine = make_engine(
            a=[{"x": None}, {"x": 1}],
            b=[{"x": 1}],
        )
        result = rows(engine, "SELECT x FROM a EXCEPT SELECT x FROM b")
        assert result == [{"x": None}]

    def test_intersect_all_null_counting(self):
        engine = make_engine(
            a=[{"x": None}, {"x": None}],
            b=[{"x": None}],
        )
        result = rows(engine, "SELECT x FROM a INTERSECT ALL SELECT x FROM b")
        # min(2, 1) = 1
        assert len(result) == 1
        assert result[0]["x"] is None


# ---------------------------------------------------------------------------
# Type unification
# ---------------------------------------------------------------------------

class TestTypeUnification:
    def test_int_and_float_match_after_cast(self):
        # Integer 1 should pair with float 1.0
        engine = make_engine(
            ints=Table.from_dicts(
                [{"x": 1}, {"x": 2}],
                Schema([Field("x", DataType.INT64)]),
            ),
            floats=Table.from_dicts(
                [{"x": 1.0}, {"x": 3.0}],
                Schema([Field("x", DataType.FLOAT64)]),
            ),
        )
        result = rows(engine, "SELECT x FROM ints INTERSECT SELECT x FROM floats")
        # 1 (int) matches 1.0 (float)
        assert len(result) == 1
        assert result[0]["x"] == 1.0

    def test_output_type_is_unified(self):
        engine = make_engine(
            ints=Table.from_dicts(
                [{"x": 1}],
                Schema([Field("x", DataType.INT64)]),
            ),
            floats=Table.from_dicts(
                [{"x": 1.0}],
                Schema([Field("x", DataType.FLOAT64)]),
            ),
        )
        result = engine.sql("SELECT x FROM ints INTERSECT SELECT x FROM floats")
        assert result.schema.fields[0].dtype == DataType.FLOAT64

    def test_except_int_float_cancellation(self):
        engine = make_engine(
            ints=Table.from_dicts(
                [{"x": 1}, {"x": 2}],
                Schema([Field("x", DataType.INT64)]),
            ),
            floats=Table.from_dicts(
                [{"x": 1.0}],
                Schema([Field("x", DataType.FLOAT64)]),
            ),
        )
        result = rows(engine, "SELECT x FROM ints EXCEPT SELECT x FROM floats")
        assert len(result) == 1
        assert result[0]["x"] == 2.0


# ---------------------------------------------------------------------------
# ORDER BY / LIMIT / OFFSET on chains
# ---------------------------------------------------------------------------

class TestChainOrderBy:
    def test_order_by_applies_to_whole_intersect_result(self):
        engine = make_engine(
            a=[{"x": 3}, {"x": 1}, {"x": 2}],
            b=[{"x": 1}, {"x": 2}, {"x": 3}],
        )
        result = rows(engine, "SELECT x FROM a INTERSECT SELECT x FROM b ORDER BY x")
        assert [r["x"] for r in result] == [1, 2, 3]

    def test_order_by_desc_on_except(self):
        engine = make_engine(
            a=[{"x": 3}, {"x": 1}, {"x": 2}],
            b=[{"x": 2}],
        )
        result = rows(engine, "SELECT x FROM a EXCEPT SELECT x FROM b ORDER BY x DESC")
        assert [r["x"] for r in result] == [3, 1]

    def test_limit_on_intersect_chain(self):
        engine = make_engine(
            a=[{"x": 1}, {"x": 2}, {"x": 3}],
            b=[{"x": 1}, {"x": 2}, {"x": 3}],
        )
        result = rows(engine, "SELECT x FROM a INTERSECT SELECT x FROM b ORDER BY x LIMIT 2")
        assert [r["x"] for r in result] == [1, 2]

    def test_offset_on_intersect_chain(self):
        engine = make_engine(
            a=[{"x": 1}, {"x": 2}, {"x": 3}],
            b=[{"x": 1}, {"x": 2}, {"x": 3}],
        )
        result = rows(
            engine,
            "SELECT x FROM a INTERSECT SELECT x FROM b ORDER BY x LIMIT 10 OFFSET 1"
        )
        assert [r["x"] for r in result] == [2, 3]


# ---------------------------------------------------------------------------
# Optimizer stability
# ---------------------------------------------------------------------------

class TestOptimizerStability:
    def test_intersect_stable_under_optimizer(self):
        from veldt.plan.optimizer import optimize
        catalog = make_catalog(
            a=[{"x": 1}, {"x": 2}],
            b=[{"x": 2}, {"x": 3}],
        )
        plan = compile_sql("SELECT x FROM a INTERSECT SELECT x FROM b", catalog)
        optimized = optimize(plan)
        # Schema should not change
        assert optimized.schema.names == plan.schema.names

    def test_except_stable_under_optimizer(self):
        from veldt.plan.optimizer import optimize
        catalog = make_catalog(
            a=[{"x": 1}, {"x": 2}],
            b=[{"x": 2}],
        )
        plan = compile_sql("SELECT x FROM a EXCEPT SELECT x FROM b", catalog)
        optimized = optimize(plan)
        assert optimized.schema.names == plan.schema.names


# ---------------------------------------------------------------------------
# Batch size independence
# ---------------------------------------------------------------------------

class TestBatchSizeIndependence:
    def test_intersect_result_unchanged_across_batch_sizes(self):
        from veldt.execution.context import ExecutionContext
        from veldt.execution.physical import create_physical_plan
        catalog = make_catalog(
            a=[{"x": i} for i in range(1, 11)],
            b=[{"x": i} for i in range(5, 15)],
        )
        plan = compile_sql(
            "SELECT x FROM a INTERSECT SELECT x FROM b ORDER BY x", catalog
        )
        for batch_size in (1, 3, 100):
            ctx = ExecutionContext(batch_size=batch_size)
            op = create_physical_plan(plan, ctx)
            result = op.collect(ctx).to_dicts()
            assert [r["x"] for r in result] == list(range(5, 11)), (
                f"Failed for batch_size={batch_size}"
            )

    def test_except_result_unchanged_across_batch_sizes(self):
        from veldt.execution.context import ExecutionContext
        from veldt.execution.physical import create_physical_plan
        catalog = make_catalog(
            a=[{"x": i} for i in range(1, 11)],
            b=[{"x": i} for i in range(5, 15)],
        )
        plan = compile_sql(
            "SELECT x FROM a EXCEPT SELECT x FROM b ORDER BY x", catalog
        )
        for batch_size in (1, 3, 100):
            ctx = ExecutionContext(batch_size=batch_size)
            op = create_physical_plan(plan, ctx)
            result = op.collect(ctx).to_dicts()
            assert [r["x"] for r in result] == list(range(1, 5)), (
                f"Failed for batch_size={batch_size}"
            )


# ---------------------------------------------------------------------------
# Multi-column rows
# ---------------------------------------------------------------------------

class TestMultiColumn:
    def test_intersect_two_columns(self):
        engine = make_engine(
            a=[{"x": 1, "y": "a"}, {"x": 2, "y": "b"}, {"x": 3, "y": "c"}],
            b=[{"x": 2, "y": "b"}, {"x": 3, "y": "d"}, {"x": 4, "y": "e"}],
        )
        result = rows(engine, "SELECT x, y FROM a INTERSECT SELECT x, y FROM b")
        # Only (2,'b') is in both
        assert result == [{"x": 2, "y": "b"}]

    def test_except_two_columns(self):
        engine = make_engine(
            a=[{"x": 1, "y": "a"}, {"x": 2, "y": "b"}],
            b=[{"x": 2, "y": "b"}],
        )
        result = rows(engine, "SELECT x, y FROM a EXCEPT SELECT x, y FROM b")
        assert result == [{"x": 1, "y": "a"}]


# ---------------------------------------------------------------------------
# Integration with SET_OPERATORS constant
# ---------------------------------------------------------------------------

class TestSetOperatorsConstant:
    def test_set_operators_includes_intersect_and_except(self):
        from veldt.sql.keywords import SET_OPERATORS
        assert "intersect" in SET_OPERATORS
        assert "except" in SET_OPERATORS
        assert "union" in SET_OPERATORS


# ---------------------------------------------------------------------------
# EXPLAIN output
# ---------------------------------------------------------------------------

class TestExplainOutput:
    def setup_method(self):
        schema = INT_SCHEMA
        source = MemorySource("t", Table.from_dicts([{"x": 1}], schema))
        self.catalog = Catalog()
        self.catalog.register("t", source)

    def _compile(self, sql):
        return compile_sql(sql, self.catalog)

    def test_intersect_distinct_explain(self):
        plan = self._compile("SELECT x FROM t INTERSECT SELECT x FROM t")
        assert "Intersect: distinct" in str(plan)

    def test_intersect_all_explain(self):
        plan = self._compile("SELECT x FROM t INTERSECT ALL SELECT x FROM t")
        assert "Intersect: all" in str(plan)

    def test_except_distinct_explain(self):
        plan = self._compile("SELECT x FROM t EXCEPT SELECT x FROM t")
        assert "Except: distinct" in str(plan)

    def test_except_all_explain(self):
        plan = self._compile("SELECT x FROM t EXCEPT ALL SELECT x FROM t")
        assert "Except: all" in str(plan)
