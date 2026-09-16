"""Tests for type resolution, evaluation and simplification."""

from __future__ import annotations

import pytest

from veldt.core.batch import RecordBatch
from veldt.core.table import Table
from veldt.errors import ColumnNotFoundError, ExecutionError, TypeMismatchError
from veldt.expr.ast import Alias, ColumnRef, Literal
from veldt.expr.evaluator import Evaluator, evaluate, evaluate_predicate
from veldt.expr.parser import parse_expression
from veldt.expr.resolver import ExpressionResolver, resolve_type
from veldt.expr.simplify import (
    combine_conjunction,
    fold_constants,
    is_constant,
    simplify,
    split_conjunction,
    split_disjunction,
)
from veldt.types.dtypes import DataType
from veldt.types.schema import Schema


@pytest.fixture
def batch() -> RecordBatch:
    table = Table.from_dicts(
        [
            {"a": 1, "b": "foo", "flag": True},
            {"a": None, "b": "bar", "flag": False},
            {"a": 5, "b": None, "flag": None},
        ]
    )
    return table.batches[0]


def values(source, batch):
    return evaluate(parse_expression(source), batch).values


class TestResolution:
    def test_resolves_column_types(self, order_schema):
        assert resolve_type(parse_expression("amount"), order_schema) is DataType.FLOAT64

    def test_unknown_columns_are_reported(self, order_schema):
        with pytest.raises(ColumnNotFoundError):
            resolve_type(parse_expression("nope"), order_schema)

    def test_arithmetic_widens_to_float(self, order_schema):
        assert resolve_type(parse_expression("id + amount"), order_schema) is DataType.FLOAT64

    def test_division_always_yields_float(self, order_schema):
        assert resolve_type(parse_expression("id / id"), order_schema) is DataType.FLOAT64

    def test_comparisons_yield_bool(self, order_schema):
        assert resolve_type(parse_expression("id > 1"), order_schema) is DataType.BOOL

    def test_concatenation_yields_string(self, order_schema):
        assert resolve_type(parse_expression("customer || status"), order_schema) is DataType.STRING

    def test_arithmetic_on_text_is_rejected(self, order_schema):
        with pytest.raises(TypeMismatchError):
            resolve_type(parse_expression("customer + 1"), order_schema)

    def test_logical_operators_require_booleans(self, order_schema):
        with pytest.raises(TypeMismatchError):
            resolve_type(parse_expression("id AND id"), order_schema)

    def test_like_requires_strings(self, order_schema):
        with pytest.raises(TypeMismatchError):
            resolve_type(parse_expression("id LIKE 'x'"), order_schema)

    def test_case_branches_must_unify(self, order_schema):
        with pytest.raises(TypeMismatchError):
            resolve_type(
                parse_expression("CASE WHEN id > 1 THEN 'x' ELSE 2 END"), order_schema
            )

    def test_case_unifies_numeric_branches(self, order_schema):
        resolved = resolve_type(
            parse_expression("CASE WHEN id > 1 THEN 1 ELSE 2.5 END"), order_schema
        )
        assert resolved is DataType.FLOAT64

    def test_impossible_casts_are_rejected(self, order_schema):
        with pytest.raises(TypeMismatchError):
            resolve_type(
                parse_expression("CAST(CAST(id AS bool) AS timestamp)"), order_schema
            )

    def test_projection_schema_disambiguates_names(self, order_schema):
        resolver = ExpressionResolver()
        schema = resolver.resolve_schema(
            [parse_expression("id"), parse_expression("id")], order_schema
        )
        assert schema.names == ["id", "id_2"]

    def test_nullability_follows_the_input(self, order_schema):
        resolver = ExpressionResolver()
        assert resolver.resolve_field(parse_expression("id"), order_schema).nullable is False
        assert resolver.resolve_field(parse_expression("amount"), order_schema).nullable is True


class TestEvaluation:
    def test_column_reference_returns_the_column(self, batch):
        assert values("a", batch) == [1, None, 5]

    def test_literals_broadcast(self, batch):
        assert values("7", batch) == [7, 7, 7]

    def test_arithmetic_propagates_null(self, batch):
        assert values("a + 1", batch) == [2, None, 6]

    def test_division_by_zero_is_null(self, batch):
        assert values("a / 0", batch) == [None, None, None]

    def test_modulo_by_zero_is_null(self, batch):
        assert values("a % 0", batch) == [None, None, None]

    def test_comparisons_are_three_valued(self, batch):
        assert values("a > 2", batch) == [False, None, True]

    def test_and_short_circuits_on_false(self, batch):
        assert values("a > 2 AND false", batch) == [False, False, False]

    def test_and_with_null_is_unknown_unless_false(self, batch):
        assert values("a > 2 AND true", batch) == [False, None, True]

    def test_or_short_circuits_on_true(self, batch):
        assert values("a > 2 OR true", batch) == [True, True, True]

    def test_not_of_null_is_null(self, batch):
        assert values("NOT (a > 2)", batch) == [True, None, False]

    def test_is_null_never_returns_null(self, batch):
        assert values("a IS NULL", batch) == [False, True, False]
        assert values("a IS NOT NULL", batch) == [True, False, True]

    def test_concatenation_propagates_null(self, batch):
        assert values("b || '!'", batch) == ["foo!", "bar!", None]

    def test_like_matches_wildcards(self, batch):
        assert values("b LIKE 'f%'", batch) == [True, False, None]

    def test_not_like_negates(self, batch):
        assert values("b NOT LIKE 'f%'", batch) == [False, True, None]

    def test_in_list_returns_unknown_when_it_may_contain_the_value(self, batch):
        assert values("a IN (1, NULL)", batch) == [True, None, None]

    def test_in_list_without_nulls_is_definite(self, batch):
        assert values("a IN (1, 5)", batch) == [True, None, True]

    def test_between_is_inclusive(self, batch):
        assert values("a BETWEEN 1 AND 5", batch) == [True, None, True]

    def test_case_falls_through_to_else(self, batch):
        assert values("CASE WHEN a > 2 THEN 'big' ELSE 'small' END", batch) == [
            "small",
            "small",
            "big",
        ]

    def test_case_without_else_yields_null(self, batch):
        assert values("CASE WHEN a > 2 THEN 'big' END", batch) == [None, None, "big"]

    def test_cast_applies_per_row(self, batch):
        assert values("CAST(a AS string)", batch) == ["1", None, "5"]

    def test_functions_apply_per_row(self, batch):
        assert values("upper(b)", batch) == ["FOO", "BAR", None]

    def test_evaluated_column_takes_the_expression_name(self, batch):
        assert evaluate(parse_expression("a + 1"), batch).name == "(a + 1)"

    def test_alias_renames_the_output(self, batch):
        aliased = Alias(parse_expression("a"), "total")
        assert evaluate(aliased, batch).name == "total"

    def test_predicate_mask_is_three_valued(self, batch):
        assert evaluate_predicate(parse_expression("a > 2"), batch) == [False, None, True]

    def test_aggregates_cannot_be_evaluated_row_wise(self, batch):
        with pytest.raises(ExecutionError):
            evaluate(parse_expression("sum(a)"), batch)

    def test_constant_evaluation_needs_no_columns(self):
        assert Evaluator().evaluate_constant(parse_expression("1 + 2")) == 3

    def test_constant_evaluation_rejects_column_references(self):
        with pytest.raises(ExecutionError):
            Evaluator().evaluate_constant(parse_expression("a + 1"))


class TestSimplify:
    def test_constants_fold(self):
        assert simplify(parse_expression("1 + 2 * 3")) == Literal(7, DataType.INT64)

    def test_pure_function_calls_fold(self):
        assert simplify(parse_expression("upper('hi')")) == Literal("HI", DataType.STRING)

    def test_column_references_are_not_constant(self):
        assert not is_constant(parse_expression("a + 1"))

    def test_aggregates_are_not_constant(self):
        assert not is_constant(parse_expression("sum(1)"))

    def test_boolean_identities(self):
        assert simplify(parse_expression("a AND true")).to_sql() == "a"
        assert simplify(parse_expression("a AND false")).to_sql() == "false"
        assert simplify(parse_expression("a OR true")).to_sql() == "true"
        assert simplify(parse_expression("a OR false")).to_sql() == "a"

    def test_duplicate_operands_collapse(self):
        assert simplify(parse_expression("a AND a")).to_sql() == "a"

    def test_double_negation_cancels(self):
        assert simplify(parse_expression("NOT (NOT a)")).to_sql() == "a"

    def test_not_pushes_into_is_null(self):
        assert simplify(parse_expression("NOT (a IS NULL)")).to_sql() == "(a IS NOT NULL)"

    def test_not_pushes_into_in_list(self):
        assert simplify(parse_expression("NOT (a IN (1, 2))")).to_sql() == "(a NOT IN (1, 2))"

    def test_arithmetic_identities(self):
        assert simplify(parse_expression("a + 0")).to_sql() == "a"
        assert simplify(parse_expression("a * 1")).to_sql() == "a"
        assert simplify(parse_expression("1 * a")).to_sql() == "a"
        assert simplify(parse_expression("a / 1")).to_sql() == "a"

    def test_single_element_in_list_becomes_equality(self):
        assert simplify(parse_expression("a IN (3)")).to_sql() == "(a = 3)"

    def test_always_true_case_branch_collapses(self):
        assert simplify(parse_expression("CASE WHEN true THEN 1 ELSE 2 END")).value == 1

    def test_false_case_branches_are_dropped(self):
        assert simplify(parse_expression("CASE WHEN false THEN 1 ELSE 2 END")).value == 2

    def test_failed_folds_are_left_alone(self):
        original = parse_expression("CAST('abc' AS bigint)")
        assert fold_constants(original) == original

    def test_split_conjunction_flattens(self):
        terms = split_conjunction(parse_expression("a > 1 AND b < 2 AND c = 3"))
        assert [term.to_sql() for term in terms] == ["(a > 1)", "(b < 2)", "(c = 3)"]

    def test_split_conjunction_treats_true_as_nothing(self):
        assert split_conjunction(parse_expression("true")) == []
        assert split_conjunction(None) == []

    def test_combine_conjunction_round_trips(self):
        original = parse_expression("a > 1 AND b < 2")
        assert combine_conjunction(split_conjunction(original)) == original

    def test_combine_conjunction_of_nothing_is_none(self):
        assert combine_conjunction([]) is None

    def test_split_disjunction_flattens(self):
        assert len(split_disjunction(parse_expression("a OR b OR c"))) == 3
