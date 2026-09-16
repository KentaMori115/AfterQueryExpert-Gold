"""Tests for the dependency-free helpers."""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from veldt.utils.hashing import fingerprint, row_key, stable_hash, value_key
from veldt.utils.iterables import (
    Peekable,
    chunked,
    first,
    flatten,
    group_by,
    index_where,
    pairwise,
    partition,
    take,
    unique,
    unique_by,
)
from veldt.utils.text import (
    display_width,
    indent_lines,
    join_with_and,
    pad,
    pluralize,
    quote_identifier,
    quote_literal,
    snake_case,
    truncate,
    wrap_words,
)
from veldt.utils.timeparse import (
    date_part,
    format_duration,
    format_timestamp,
    parse_duration,
    parse_timestamp,
    try_parse_timestamp,
)
from veldt.utils.validation import (
    require,
    require_non_empty,
    require_one_of,
    require_positive,
    require_same_length,
    require_type,
    require_unique,
)


class TestChunked:
    def test_splits_into_even_chunks(self):
        assert list(chunked(range(6), 2)) == [[0, 1], [2, 3], [4, 5]]

    def test_final_chunk_may_be_short(self):
        assert list(chunked(range(5), 2)) == [[0, 1], [2, 3], [4]]

    def test_empty_input_yields_nothing(self):
        assert list(chunked([], 3)) == []

    def test_rejects_non_positive_size(self):
        with pytest.raises(ValueError):
            list(chunked([1], 0))


class TestIterableHelpers:
    def test_unique_preserves_first_seen_order(self):
        assert unique([3, 1, 3, 2, 1]) == [3, 1, 2]

    def test_unique_handles_unhashable_values(self):
        assert unique([[1], [2], [1]]) == [[1], [2]]

    def test_unique_by_uses_the_key(self):
        assert unique_by(["aa", "ab", "b"], lambda item: item[0]) == ["aa", "b"]

    def test_flatten_goes_one_level_deep(self):
        assert list(flatten([[1, 2], [], [3]])) == [1, 2, 3]

    def test_first_returns_none_when_nothing_matches(self):
        assert first([1, 3], lambda value: value % 2 == 0) is None

    def test_partition_splits_on_the_predicate(self):
        assert partition(range(5), lambda value: value % 2 == 0) == ([0, 2, 4], [1, 3])

    def test_group_by_keeps_insertion_order(self):
        grouped = group_by(["ant", "bee", "ape"], lambda item: item[0])
        assert list(grouped) == ["a", "b"]
        assert grouped["a"] == ["ant", "ape"]

    def test_pairwise_yields_overlapping_pairs(self):
        assert list(pairwise([1, 2, 3])) == [(1, 2), (2, 3)]

    def test_index_where_reports_missing_as_minus_one(self):
        assert index_where([1, 2], lambda value: value > 5) == -1

    def test_take_stops_early(self):
        assert take(range(100), 3) == [0, 1, 2]
        assert take(range(3), 0) == []


class TestPeekable:
    def test_peek_does_not_consume(self):
        stream = Peekable([1, 2])
        assert stream.peek() == 1
        assert next(stream) == 1
        assert next(stream) == 2

    def test_peek_past_the_end_returns_the_default(self):
        stream = Peekable([])
        assert stream.peek("done") == "done"
        assert stream.exhausted

    def test_push_back_restores_an_item(self):
        stream = Peekable([1])
        value = next(stream)
        stream.push_back(value)
        assert next(stream) == 1


class TestText:
    def test_pad_aligns_left_right_and_centre(self):
        assert pad("ab", 5) == "ab   "
        assert pad("ab", 5, "right") == "   ab"
        assert pad("ab", 5, "center") == " ab  "

    def test_pad_rejects_unknown_alignment(self):
        with pytest.raises(ValueError):
            pad("ab", 5, "middle")

    def test_pad_leaves_oversized_text_alone(self):
        assert pad("abcdef", 3) == "abcdef"

    def test_truncate_adds_a_marker(self):
        assert truncate("abcdefgh", 5) == "ab..."
        assert truncate("abc", 5) == "abc"

    def test_quote_identifier_only_when_needed(self):
        assert quote_identifier("name") == "name"
        assert quote_identifier("count(*)") == '"count(*)"'
        assert quote_identifier('a"b') == '"a""b"'

    def test_quote_literal_doubles_apostrophes(self):
        assert quote_literal("it's") == "'it''s'"

    def test_snake_case_splits_camel_case(self):
        assert snake_case("CamelCaseName") == "camel_case_name"
        assert snake_case("with spaces") == "with_spaces"

    def test_join_with_and_reads_naturally(self):
        assert join_with_and(["a"]) == "a"
        assert join_with_and(["a", "b"]) == "a and b"
        assert join_with_and(["a", "b", "c"]) == "a, b and c"

    def test_pluralize_respects_count(self):
        assert pluralize(1, "row") == "1 row"
        assert pluralize(2, "row") == "2 rows"

    def test_indent_lines_can_skip_the_first(self):
        assert indent_lines("a\nb", "  ", skip_first=True) == "a\n  b"

    def test_wrap_words_respects_the_width(self):
        assert wrap_words("one two three", 7) == ["one two", "three"]

    def test_display_width_ignores_combining_marks(self):
        assert display_width("á") == 1


class TestTimeparse:
    def test_parses_common_timestamp_layouts(self):
        assert parse_timestamp("2026-05-15") == datetime(2026, 5, 15)
        assert parse_timestamp("2026-05-15 08:30:00") == datetime(2026, 5, 15, 8, 30)
        assert parse_timestamp("2026-05-15T08:30:00Z") == datetime(2026, 5, 15, 8, 30)

    def test_try_parse_returns_none_for_junk(self):
        assert try_parse_timestamp("not a date") is None
        assert try_parse_timestamp("") is None

    def test_parse_timestamp_raises_for_junk(self):
        with pytest.raises(ValueError):
            parse_timestamp("not a date")

    def test_format_timestamp_round_trips(self):
        moment = datetime(2026, 6, 1, 12, 0, 5)
        assert parse_timestamp(format_timestamp(moment)) == moment

    def test_parse_duration_handles_compound_values(self):
        assert parse_duration("2h30m") == timedelta(hours=2, minutes=30)
        assert parse_duration("150ms") == timedelta(milliseconds=150)

    def test_parse_duration_rejects_junk(self):
        with pytest.raises(ValueError):
            parse_duration("soon")

    def test_format_duration_round_trips(self):
        assert format_duration(timedelta(hours=1, minutes=2)) == "1h2m"

    def test_date_part_extracts_components(self):
        moment = datetime(2026, 5, 15, 8, 30, 45)
        assert date_part("year", moment) == 2026
        assert date_part("quarter", moment) == 2
        assert date_part("dayofweek", moment) == 5

    def test_date_part_rejects_unknown_names(self):
        with pytest.raises(ValueError):
            date_part("fortnight", datetime(2026, 1, 1))


class TestValidation:
    def test_require_raises_the_requested_error(self):
        with pytest.raises(KeyError):
            require(False, "boom", KeyError)

    def test_require_type_reports_the_actual_type(self):
        with pytest.raises(TypeError, match="got int"):
            require_type(3, str, "name")

    def test_require_positive_rejects_zero(self):
        with pytest.raises(ValueError):
            require_positive(0, "size")

    def test_require_non_empty_rejects_empty_collections(self):
        with pytest.raises(ValueError):
            require_non_empty([], "items")

    def test_require_one_of_lists_the_options(self):
        with pytest.raises(ValueError, match="must be one of"):
            require_one_of("x", ["a", "b"], "mode")

    def test_require_unique_detects_duplicates(self):
        with pytest.raises(ValueError):
            require_unique([1, 2, 1], "values")

    def test_require_same_length_compares_lengths(self):
        with pytest.raises(ValueError):
            require_same_length([1], [1, 2], "pair")


class TestHashing:
    def test_value_key_separates_bools_from_ints(self):
        assert value_key(True) != value_key(1)

    def test_value_key_separates_ints_from_floats(self):
        assert value_key(1) != value_key(1.0)

    def test_value_key_collapses_nan(self):
        assert value_key(float("nan")) == value_key(float("nan"))

    def test_row_key_is_order_sensitive(self):
        assert row_key([1, 2]) != row_key([2, 1])

    def test_stable_hash_is_deterministic(self):
        assert stable_hash("veldt") == stable_hash("veldt")

    def test_fingerprint_has_the_requested_length(self):
        assert len(fingerprint([1, "a", None], 8)) == 8
