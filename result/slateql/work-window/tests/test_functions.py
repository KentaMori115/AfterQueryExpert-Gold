"""Tests for the built-in function library and the registry."""

from __future__ import annotations

import datetime as dt

import pytest

from slateql.errors import ExecutionError, UnknownFunctionError
from slateql.functions.aggregate_defs import (
    AvgAccumulator,
    BoolAndAccumulator,
    BoolOrAccumulator,
    CountAccumulator,
    MaxAccumulator,
    MinAccumulator,
    StringAggAccumulator,
    SumAccumulator,
    VarianceAccumulator,
)
from slateql.functions.registry import FunctionRegistry, builtin_registry
from slateql.functions.scalar_datetime import extract_field, truncate_to
from slateql.functions.scalar_string import like_to_regex, matches_like
from slateql.functions.signature import Arity


@pytest.fixture()
def registry() -> FunctionRegistry:
    return builtin_registry()


def call(registry: FunctionRegistry, name: str, *args):
    return registry.scalar(name).call(list(args))


def test_arity_descriptions():
    assert Arity.exactly(2).describe() == "exactly 2"
    assert Arity.at_least(1).describe() == "at least 1"
    assert Arity.between(1, 3).describe() == "between 1 and 3"


def test_unknown_function_suggests_a_near_miss(registry):
    with pytest.raises(UnknownFunctionError) as info:
        registry.scalar("uppr")
    assert "upper" in str(info.value)


def test_aggregate_used_as_scalar_is_reported(registry):
    with pytest.raises(UnknownFunctionError) as info:
        registry.scalar("sum")
    assert "aggregate" in str(info.value)


def test_aliases_resolve_to_the_same_definition(registry):
    assert registry.scalar("ucase") is registry.scalar("upper")


def test_null_propagates_through_most_functions(registry):
    assert call(registry, "upper", None) is None


def test_coalesce_sees_nulls(registry):
    assert call(registry, "coalesce", None, None, 3) == 3
    assert call(registry, "coalesce", None, None) is None


def test_nullif(registry):
    assert call(registry, "nullif", 1, 1) is None
    assert call(registry, "nullif", 1, 2) == 1


def test_substr_is_one_based(registry):
    assert call(registry, "substr", "abcdef", 2, 3) == "bcd"
    assert call(registry, "substr", "abcdef", 0, 2) == "ab"


def test_substr_with_negative_start_counts_from_the_end(registry):
    assert call(registry, "substr", "abcdef", -2) == "ef"


def test_split_part_out_of_range_is_null(registry):
    assert call(registry, "split_part", "a,b", ",", 5) is None
    assert call(registry, "split_part", "a,b", ",", -1) == "b"


def test_pad_functions(registry):
    assert call(registry, "lpad", "7", 3, "0") == "007"
    assert call(registry, "rpad", "7", 3, "0") == "700"
    assert call(registry, "lpad", "abcdef", 3) == "abc"


def test_position_is_one_based_and_zero_when_absent(registry):
    assert call(registry, "position", "cd", "abcdef") == 3
    assert call(registry, "position", "zz", "abcdef") == 0


def test_greatest_and_least_ignore_nulls(registry):
    assert call(registry, "greatest", 1, None, 5) == 5
    assert call(registry, "least", 1, None, 5) == 1


def test_round_keeps_integers_integral(registry):
    assert call(registry, "round", 5) == 5
    assert call(registry, "round", 2.345, 2) == 2.35


def test_trunc_moves_toward_zero(registry):
    assert call(registry, "trunc", -2.7) == -2
    assert call(registry, "trunc", 2.7) == 2


def test_mod_matches_the_sign_of_the_dividend(registry):
    assert call(registry, "mod", -7, 3) == -1
    assert call(registry, "mod", 7, 3) == 1


def test_mod_by_zero_is_an_error(registry):
    with pytest.raises(ExecutionError):
        call(registry, "mod", 1, 0)


def test_sqrt_of_a_negative_is_an_error(registry):
    with pytest.raises(ExecutionError):
        call(registry, "sqrt", -1)


def test_ln_requires_a_positive_argument(registry):
    with pytest.raises(ExecutionError):
        call(registry, "ln", 0)


def test_extract_fields():
    stamp = dt.datetime(2024, 5, 6, 7, 8, 9)
    assert extract_field("year", stamp) == 2024
    assert extract_field("quarter", stamp) == 2
    assert extract_field("dayofweek", stamp) == 1
    assert extract_field("hour", stamp) == 7


def test_extract_rejects_unknown_fields():
    with pytest.raises(ExecutionError):
        extract_field("fortnight", dt.date(2024, 1, 1))


def test_truncate_to_units():
    stamp = dt.datetime(2024, 5, 6, 7, 8, 9)
    assert truncate_to("month", stamp) == dt.datetime(2024, 5, 1)
    assert truncate_to("week", stamp) == dt.datetime(2024, 5, 6)
    assert truncate_to("hour", stamp) == dt.datetime(2024, 5, 6, 7)


def test_date_diff_counts_whole_days(registry):
    assert call(registry, "date_diff", dt.date(2024, 3, 1), dt.date(2024, 2, 1)) == 29


def test_now_is_marked_volatile(registry):
    assert registry.scalar("now").volatile


def test_like_translation():
    assert like_to_regex("a%b_") == "^a.*b.$"
    assert matches_like("axxbc", "a%b_")
    assert not matches_like("AXXBC", "a%b_")


def test_like_escape_makes_wildcards_literal():
    assert matches_like("a_b", "a!_b", "!")
    assert not matches_like("axb", "a!_b", "!")


def test_count_accumulator_skips_nulls():
    accumulator = CountAccumulator()
    for value in (1, None, 3):
        accumulator.update([value])
    assert accumulator.result() == 2


def test_count_star_counts_every_row():
    accumulator = CountAccumulator(star=True)
    for _ in range(3):
        accumulator.update([])
    assert accumulator.result() == 3


def test_sum_of_all_nulls_is_null():
    accumulator = SumAccumulator()
    accumulator.update([None])
    assert accumulator.result() is None


def test_sum_of_integers_stays_integral():
    accumulator = SumAccumulator(integral=True)
    for value in (1, 2, 3):
        accumulator.update([value])
    assert accumulator.result() == 6
    assert isinstance(accumulator.result(), int)


def test_avg_of_empty_group_is_null():
    assert AvgAccumulator().result() is None


def test_min_and_max_ignore_nulls():
    minimum, maximum = MinAccumulator(), MaxAccumulator()
    for value in (3, None, 1, 2):
        minimum.update([value])
        maximum.update([value])
    assert (minimum.result(), maximum.result()) == (1, 3)


def test_bool_aggregates_return_null_for_all_null_groups():
    assert BoolAndAccumulator().result() is None
    assert BoolOrAccumulator().result() is None


def test_bool_and_requires_every_value():
    accumulator = BoolAndAccumulator()
    accumulator.update([True])
    accumulator.update([False])
    assert accumulator.result() is False


def test_string_agg_uses_the_separator_argument():
    accumulator = StringAggAccumulator()
    accumulator.update(["a", "-"])
    accumulator.update(["b", "-"])
    assert accumulator.result() == "a-b"


def test_variance_needs_two_samples_for_the_sample_variant():
    accumulator = VarianceAccumulator(sample=True)
    accumulator.update([1])
    assert accumulator.result() is None


def test_population_variance_of_a_known_series():
    accumulator = VarianceAccumulator(sample=False)
    for value in (2, 4, 4, 4, 5, 5, 7, 9):
        accumulator.update([value])
    assert accumulator.result() == pytest.approx(4.0)


def test_registry_entries_describe_every_function(registry):
    entries = registry.entries()
    kinds = {entry.kind for entry in entries}
    assert kinds == {"scalar", "aggregate"}
    assert any(entry.aliases for entry in entries)


def test_child_registry_falls_back_to_its_parent(registry):
    child = FunctionRegistry(parent=registry)
    assert child.has("upper")
    assert child.is_aggregate("sum")
