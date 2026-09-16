"""Tests for scalar functions and aggregate accumulators."""

from __future__ import annotations

import math
from datetime import datetime

import pytest

from veldt.errors import FunctionNotFoundError, TypeMismatchError
from veldt.expr.aggregates import AggregateRegistry, default_aggregate_registry
from veldt.expr.functions import (
    FunctionRegistry,
    ScalarFunction,
    default_registry,
    like_to_regex,
)
from veldt.types.dtypes import DataType


@pytest.fixture
def functions() -> FunctionRegistry:
    return default_registry()


@pytest.fixture
def aggregates() -> AggregateRegistry:
    return default_aggregate_registry()


def call(functions, name, *args):
    return functions.get(name).call(list(args))


class TestRegistry:
    def test_lookup_is_case_insensitive(self, functions):
        assert functions.get("UPPER").name == "upper"

    def test_unknown_function_is_reported(self, functions):
        with pytest.raises(FunctionNotFoundError):
            functions.get("nope")

    def test_unknown_function_suggests_a_neighbour(self, functions):
        with pytest.raises(FunctionNotFoundError) as error:
            functions.get("uppr")
        assert "upper" in str(error.value)

    def test_duplicate_registration_needs_replace(self, functions):
        duplicate = ScalarFunction("upper", str.upper, DataType.STRING)
        with pytest.raises(ValueError):
            functions.register(duplicate)
        functions.register(duplicate, replace=True)

    def test_copy_is_independent(self, functions):
        clone = functions.copy()
        clone.register(ScalarFunction("twice", lambda v: v * 2, DataType.INT64))
        assert "twice" in clone
        assert "twice" not in functions

    def test_arity_is_enforced_during_resolution(self, functions):
        with pytest.raises(TypeMismatchError):
            functions.get("upper").resolve_type([DataType.STRING, DataType.STRING])

    def test_variadic_functions_accept_many_arguments(self, functions):
        assert functions.get("concat").accepts(5)


class TestNullPropagation:
    def test_ordinary_functions_return_null_for_null_input(self, functions):
        assert call(functions, "upper", None) is None
        assert call(functions, "abs", None) is None

    def test_coalesce_sees_nulls(self, functions):
        assert call(functions, "coalesce", None, None, 3) == 3
        assert call(functions, "coalesce", None) is None

    def test_concat_treats_nulls_as_empty(self, functions):
        assert call(functions, "concat", "a", None, "b") == "ab"

    def test_ifnull_replaces_only_nulls(self, functions):
        assert call(functions, "ifnull", None, "x") == "x"
        assert call(functions, "ifnull", "a", "x") == "a"

    def test_nullif_blanks_equal_values(self, functions):
        assert call(functions, "nullif", 1, 1) is None
        assert call(functions, "nullif", 1, 2) == 1


class TestStringFunctions:
    def test_case_and_length(self, functions):
        assert call(functions, "upper", "aB") == "AB"
        assert call(functions, "lower", "aB") == "ab"
        assert call(functions, "length", "abc") == 3

    def test_trimming(self, functions):
        assert call(functions, "trim", "  a  ") == "a"
        assert call(functions, "ltrim", "  a") == "a"
        assert call(functions, "rtrim", "a  ") == "a"

    def test_substr_is_one_based(self, functions):
        assert call(functions, "substr", "abcdef", 2, 3) == "bcd"
        assert call(functions, "substr", "abcdef", 3) == "cdef"

    def test_substr_clamps_a_low_start(self, functions):
        assert call(functions, "substr", "abc", 0, 2) == "ab"

    def test_predicates(self, functions):
        assert call(functions, "starts_with", "abc", "ab") is True
        assert call(functions, "ends_with", "abc", "bc") is True
        assert call(functions, "contains", "abc", "b") is True

    def test_split_part_is_one_based_and_bounded(self, functions):
        assert call(functions, "split_part", "a-b-c", "-", 2) == "b"
        assert call(functions, "split_part", "a-b", "-", 9) == ""

    def test_padding(self, functions):
        assert call(functions, "lpad", "7", 3, "0") == "007"
        assert call(functions, "rpad", "7", 3, "0") == "700"

    def test_replace_and_reverse(self, functions):
        assert call(functions, "replace", "aXa", "X", "-") == "a-a"
        assert call(functions, "reverse", "abc") == "cba"


class TestNumericFunctions:
    def test_rounding_goes_half_away_from_zero(self, functions):
        assert call(functions, "round", 2.5) == 3.0
        assert call(functions, "round", -2.5) == -3.0
        assert call(functions, "round", 2.345, 2) == 2.35

    def test_floor_and_ceil(self, functions):
        assert call(functions, "floor", 2.7) == 2
        assert call(functions, "ceil", 2.1) == 3

    def test_abs_and_sign(self, functions):
        assert call(functions, "abs", -3) == 3
        assert call(functions, "sign", -3) == -1
        assert call(functions, "sign", 0) == 0

    def test_sqrt_of_a_negative_is_null(self, functions):
        assert call(functions, "sqrt", -1) is None
        assert call(functions, "sqrt", 9) == 3.0

    def test_logarithms_reject_non_positive_input(self, functions):
        assert call(functions, "ln", 0) is None
        assert call(functions, "log", 100) == pytest.approx(2.0)

    def test_mod_and_safe_divide_guard_zero(self, functions):
        assert call(functions, "mod", 7, 0) is None
        assert call(functions, "mod", 7, 3) == 1
        assert call(functions, "safe_divide", 1, 0) is None

    def test_greatest_and_least_skip_nulls(self, functions):
        assert call(functions, "greatest", 1, None, 5) == 5
        assert call(functions, "least", 1, None, 5) == 1
        assert call(functions, "greatest", None) is None

    def test_numeric_functions_reject_text(self, functions):
        with pytest.raises(TypeMismatchError):
            functions.get("abs").resolve_type([DataType.STRING])


class TestTemporalFunctions:
    def test_date_part_by_name(self, functions):
        moment = datetime(2026, 5, 15, 8, 30)
        assert call(functions, "date_part", "month", moment) == 5

    def test_shortcut_functions(self, functions):
        moment = datetime(2026, 5, 15, 8, 30, 45)
        assert call(functions, "year", moment) == 2026
        assert call(functions, "day", moment) == 15
        assert call(functions, "second", moment) == 45

    def test_conversion_functions(self, functions):
        assert call(functions, "to_int", "42") == 42
        assert call(functions, "to_string", 42) == "42"
        assert call(functions, "to_timestamp", "2026-01-02") == datetime(2026, 1, 2)


class TestLikePatterns:
    def test_percent_and_underscore(self):
        assert like_to_regex("a%") == "^a.*$"
        assert like_to_regex("a_") == "^a.$"

    def test_regex_metacharacters_are_escaped(self):
        assert like_to_regex("a.b") == "^a\\.b$"

    def test_backslash_escapes_a_wildcard(self):
        assert like_to_regex("50\\%") == "^50%$"


class TestAggregates:
    def test_count_star_counts_every_row(self, aggregates):
        accumulator = aggregates.get("count").create([])
        accumulator.update_many([None, 1, None])
        assert accumulator.finalize() == 3

    def test_count_of_a_column_ignores_nulls(self, aggregates):
        accumulator = aggregates.get("count").create([DataType.INT64])
        accumulator.update_many([None, 1, 2])
        assert accumulator.finalize() == 2

    def test_sum_of_no_values_is_null(self, aggregates):
        accumulator = aggregates.get("sum").create([DataType.INT64])
        accumulator.update_many([None])
        assert accumulator.finalize() is None

    def test_sum_keeps_integers_integral(self, aggregates):
        accumulator = aggregates.get("sum").create([DataType.INT64])
        accumulator.update_many([1, 2])
        assert accumulator.finalize() == 3
        assert isinstance(accumulator.finalize(), int)

    def test_avg_divides_by_non_null_count(self, aggregates):
        accumulator = aggregates.get("avg").create([DataType.INT64])
        accumulator.update_many([1, 2, None, 4])
        assert accumulator.finalize() == pytest.approx(7 / 3)

    def test_min_and_max_ignore_nulls(self, aggregates):
        smallest = aggregates.get("min").create([DataType.INT64])
        largest = aggregates.get("max").create([DataType.INT64])
        for value in [3, None, 1]:
            smallest.update(value)
            largest.update(value)
        assert (smallest.finalize(), largest.finalize()) == (1, 3)

    def test_stddev_matches_the_sample_formula(self, aggregates):
        accumulator = aggregates.get("stddev").create([DataType.FLOAT64])
        accumulator.update_many([2, 4, 4, 4, 5, 5, 7, 9])
        assert accumulator.finalize() == pytest.approx(2.13808993, rel=1e-6)

    def test_variance_needs_two_values(self, aggregates):
        accumulator = aggregates.get("variance").create([DataType.FLOAT64])
        accumulator.update(1)
        assert accumulator.finalize() is None

    def test_first_and_last_skip_nulls(self, aggregates):
        first = aggregates.get("first").create([DataType.STRING])
        last = aggregates.get("last").create([DataType.STRING])
        for value in [None, "a", "b", None]:
            first.update(value)
            last.update(value)
        assert (first.finalize(), last.finalize()) == ("a", "b")

    def test_string_agg_joins_with_commas(self, aggregates):
        accumulator = aggregates.get("string_agg").create([DataType.STRING])
        accumulator.update_many(["a", None, "b"])
        assert accumulator.finalize() == "a,b"

    def test_bool_reductions(self, aggregates):
        conjunction = aggregates.get("bool_and").create([DataType.BOOL])
        disjunction = aggregates.get("bool_or").create([DataType.BOOL])
        for value in [True, False]:
            conjunction.update(value)
            disjunction.update(value)
        assert conjunction.finalize() is False
        assert disjunction.finalize() is True

    def test_merge_combines_partial_state(self, aggregates):
        left = aggregates.get("avg").create([DataType.INT64])
        right = aggregates.get("avg").create([DataType.INT64])
        left.update_many([1, 2])
        right.update_many([3, 4])
        left.merge(right)
        assert left.finalize() == pytest.approx(2.5)

    def test_merging_different_kinds_is_rejected(self, aggregates):
        left = aggregates.get("avg").create([DataType.INT64])
        right = aggregates.get("sum").create([DataType.INT64])
        with pytest.raises(TypeError):
            left.merge(right)

    def test_sum_rejects_text(self, aggregates):
        with pytest.raises(TypeMismatchError):
            aggregates.get("sum").resolve_type([DataType.STRING])

    def test_min_returns_its_input_type(self, aggregates):
        assert aggregates.get("min").resolve_type([DataType.STRING]) is DataType.STRING
