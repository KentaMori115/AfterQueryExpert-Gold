"""Tests for expression evaluation, especially three-valued logic."""

from __future__ import annotations

import pytest

from slateql.errors import ExecutionError
from slateql.execution.evaluator import ExpressionEvaluator
from slateql.functions.registry import builtin_registry
from slateql.plan import expressions as X
from slateql.types.datatypes import BOOLEAN, DOUBLE, INTEGER, NULL, STRING
from slateql.types.schema import Schema

SCHEMA = Schema.of(("a", INTEGER), ("b", INTEGER), ("s", STRING))


@pytest.fixture()
def evaluator() -> ExpressionEvaluator:
    return ExpressionEvaluator(builtin_registry())


def run(evaluator, expression, row):
    return evaluator.compile(expression, SCHEMA)(row)


def col(name, dtype=INTEGER):
    return X.Column(name=name, dtype=dtype)


def lit(value, dtype=INTEGER):
    return X.Literal(value=value, dtype=dtype)


def test_column_reads_by_ordinal(evaluator):
    assert run(evaluator, col("b"), [1, 2, "x"]) == 2


def test_and_is_false_when_either_side_is_false(evaluator):
    expression = X.BinaryExpr(
        op="AND", left=lit(False, BOOLEAN), right=lit(None, NULL), dtype=BOOLEAN
    )
    assert run(evaluator, expression, [1, 2, "x"]) is False


def test_and_is_null_when_neither_side_is_false(evaluator):
    expression = X.BinaryExpr(
        op="AND", left=lit(True, BOOLEAN), right=lit(None, NULL), dtype=BOOLEAN
    )
    assert run(evaluator, expression, [1, 2, "x"]) is None


def test_or_is_true_when_either_side_is_true(evaluator):
    expression = X.BinaryExpr(
        op="OR", left=lit(None, NULL), right=lit(True, BOOLEAN), dtype=BOOLEAN
    )
    assert run(evaluator, expression, [1, 2, "x"]) is True


def test_or_is_null_when_neither_side_is_true(evaluator):
    expression = X.BinaryExpr(
        op="OR", left=lit(None, NULL), right=lit(False, BOOLEAN), dtype=BOOLEAN
    )
    assert run(evaluator, expression, [1, 2, "x"]) is None


def test_not_null_is_null(evaluator):
    expression = X.UnaryExpr(op="NOT", operand=lit(None, NULL), dtype=BOOLEAN)
    assert run(evaluator, expression, [1, 2, "x"]) is None


def test_comparison_with_null_is_null(evaluator):
    expression = X.BinaryExpr(op="=", left=col("a"), right=lit(None, NULL), dtype=BOOLEAN)
    assert run(evaluator, expression, [1, 2, "x"]) is None


def test_arithmetic_with_null_is_null(evaluator):
    expression = X.BinaryExpr(op="+", left=col("a"), right=lit(None, NULL), dtype=INTEGER)
    assert run(evaluator, expression, [1, 2, "x"]) is None


def test_division_by_zero_raises(evaluator):
    expression = X.BinaryExpr(op="/", left=col("a"), right=lit(0), dtype=DOUBLE)
    with pytest.raises(ExecutionError):
        run(evaluator, expression, [1, 2, "x"])


def test_concat_of_strings(evaluator):
    expression = X.BinaryExpr(
        op="||", left=col("s", STRING), right=lit("!", STRING), dtype=STRING
    )
    assert run(evaluator, expression, [1, 2, "x"]) == "x!"


def test_is_null_never_returns_null(evaluator):
    expression = X.IsNull(operand=lit(None, NULL))
    assert run(evaluator, expression, [1, 2, "x"]) is True


def test_is_not_null(evaluator):
    expression = X.IsNull(operand=col("a"), negated=True)
    assert run(evaluator, expression, [1, 2, "x"]) is True


def test_in_list_with_a_null_and_no_match_is_null(evaluator):
    expression = X.InList(
        operand=col("a"), items=(lit(5), lit(None, NULL))
    )
    assert run(evaluator, expression, [1, 2, "x"]) is None


def test_in_list_with_a_match_ignores_nulls(evaluator):
    expression = X.InList(operand=col("a"), items=(lit(1), lit(None, NULL)))
    assert run(evaluator, expression, [1, 2, "x"]) is True


def test_not_in_with_a_null_is_null(evaluator):
    expression = X.InList(
        operand=col("a"), items=(lit(5), lit(None, NULL)), negated=True
    )
    assert run(evaluator, expression, [1, 2, "x"]) is None


def test_not_in_without_nulls_is_true(evaluator):
    expression = X.InList(operand=col("a"), items=(lit(5),), negated=True)
    assert run(evaluator, expression, [1, 2, "x"]) is True


def test_case_falls_through_to_the_default(evaluator):
    expression = X.CaseExpr(
        branches=(X.CaseBranch(condition=lit(False, BOOLEAN), result=lit(1)),),
        dtype=INTEGER,
        default=lit(9),
    )
    assert run(evaluator, expression, [1, 2, "x"]) == 9


def test_case_without_a_default_is_null(evaluator):
    expression = X.CaseExpr(
        branches=(X.CaseBranch(condition=lit(None, NULL), result=lit(1)),),
        dtype=INTEGER,
    )
    assert run(evaluator, expression, [1, 2, "x"]) is None


def test_cast_failure_is_null_by_default(evaluator):
    expression = X.CastExpr(operand=lit("nope", STRING), dtype=INTEGER)
    assert run(evaluator, expression, [1, 2, "x"]) is None


def test_cast_failure_raises_in_strict_mode():
    strict = ExpressionEvaluator(builtin_registry(), strict_casts=True)
    expression = X.CastExpr(operand=lit("nope", STRING), dtype=INTEGER)
    with pytest.raises(ExecutionError):
        strict.compile(expression, SCHEMA)([1, 2, "x"])


def test_like_escape_must_be_one_character(evaluator):
    expression = X.LikeMatch(
        operand=col("s", STRING),
        pattern=lit("x", STRING),
        escape=lit("ab", STRING),
    )
    with pytest.raises(ExecutionError):
        run(evaluator, expression, [1, 2, "x"])


def test_predicate_compilation_treats_null_as_false(evaluator):
    predicate = evaluator.compile_predicate(lit(None, NULL), SCHEMA)
    assert predicate([1, 2, "x"]) is False


def test_aggregates_cannot_be_evaluated_directly(evaluator):
    call = X.AggregateCall(name="count", args=(), dtype=INTEGER, star=True)
    with pytest.raises(ExecutionError):
        evaluator.compile(call, SCHEMA)
