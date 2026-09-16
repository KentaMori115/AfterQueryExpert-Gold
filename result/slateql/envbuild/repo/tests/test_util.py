"""Tests for the shared utility helpers."""

from __future__ import annotations

import pytest

from slateql.errors import ExecutionError, format_caret
from slateql.util.iterables import (
    batched,
    chunk_indices,
    dedupe,
    first,
    flatten,
    partition,
    sequence_equal,
)
from slateql.util.ordering import SortKey, compare_values, make_row_key
from slateql.util.table_render import format_cell, render_table
from slateql.util.text import (
    edit_distance,
    indent_block,
    needs_quoting,
    plural,
    quote_identifier,
    suggest,
    truncate,
    unquote_identifier,
)
from slateql.util.timing import Stopwatch, Timings, format_duration


def test_batched_splits_and_keeps_the_remainder():
    assert [len(b) for b in batched(range(7), 3)] == [3, 3, 1]


def test_batched_rejects_a_non_positive_size():
    with pytest.raises(ValueError):
        list(batched([1], 0))


def test_dedupe_preserves_first_occurrence():
    assert dedupe([3, 1, 3, 2, 1]) == [3, 1, 2]


def test_dedupe_with_a_key():
    assert dedupe(["aa", "ab", "b"], key=lambda s: s[0]) == ["aa", "b"]


def test_first_returns_none_when_nothing_matches():
    assert first([1, 2], lambda x: x > 5) is None
    assert first([1, 2]) == 1


def test_flatten_removes_one_level():
    assert flatten([[1, 2], [3]]) == [1, 2, 3]


def test_partition_preserves_order():
    assert partition(range(5), lambda x: x % 2 == 0) == ([0, 2, 4], [1, 3])


def test_chunk_indices_covers_the_range():
    assert list(chunk_indices(5, 2)) == [(0, 2), (2, 4), (4, 5)]


def test_sequence_equal_ignores_container_type():
    assert sequence_equal([1, 2], (1, 2))
    assert not sequence_equal([1], [1, 2])


def test_compare_values_puts_nulls_last_by_default():
    assert compare_values(None, 1) > 0
    assert compare_values(None, 1, nulls_first=True) < 0
    assert compare_values(None, None) == 0


def test_compare_values_rejects_incomparable_types():
    with pytest.raises(ExecutionError):
        compare_values("a", 1)


def test_sort_key_orders_descending_with_nulls_last():
    rows = [[3], [None], [1], [2]]
    key = make_row_key([SortKey(getter=lambda row: row[0], descending=True)])
    assert [row[0] for row in sorted(rows, key=key)] == [3, 2, 1, None]


def test_sort_key_nulls_first():
    rows = [[2], [None], [1]]
    key = make_row_key([SortKey(getter=lambda row: row[0], nulls_first=True)])
    assert [row[0] for row in sorted(rows, key=key)] == [None, 1, 2]


def test_make_row_key_requires_a_key():
    with pytest.raises(ValueError):
        make_row_key([])


def test_quote_identifier_only_when_needed():
    assert quote_identifier("abc") == "abc"
    assert quote_identifier("a b") == '"a b"'
    assert quote_identifier('a"b') == '"a""b"'


def test_needs_quoting_rules():
    assert not needs_quoting("abc_1")
    assert needs_quoting("1abc")
    assert needs_quoting("")


def test_unquote_identifier_round_trips():
    assert unquote_identifier(quote_identifier('a"b')) == 'a"b'
    assert unquote_identifier("plain") == "plain"


def test_truncate_adds_an_ellipsis():
    assert truncate("abcdef", 5) == "ab..."
    assert truncate("abc", 5) == "abc"
    assert truncate("abcdef", 0) == ""


def test_plural_agrees_with_the_count():
    assert plural(1, "row") == "1 row"
    assert plural(2, "row") == "2 rows"


def test_indent_block_leaves_blank_lines_alone():
    assert indent_block("a\n\nb") == "  a\n\n  b"


def test_edit_distance_basics():
    assert edit_distance("kitten", "sitting") == 3
    assert edit_distance("a", "a") == 0
    assert edit_distance("", "abc") == 3


def test_suggest_ignores_distant_candidates():
    assert suggest("nmae", ["name", "unrelated"]) == ["name"]
    assert suggest("zzzz", ["name"]) == []


def test_format_cell_renders_sql_values():
    assert format_cell(None) == "NULL"
    assert format_cell(True) == "true"
    assert format_cell(float("nan")) == "NaN"
    assert format_cell(float("inf")) == "Infinity"


def test_render_table_without_columns():
    assert render_table([], []) == "(no columns)"


def test_render_table_keeps_the_header_for_empty_results():
    text = render_table(["a"], [])
    assert "| a |" in text


def test_render_table_reports_hidden_rows():
    text = render_table(["a"], [[1], [2], [3]], max_rows=1)
    assert "2 more rows not shown" in text


def test_format_duration_picks_a_unit():
    assert format_duration(0.0000005).endswith("us")
    assert format_duration(0.05).endswith("ms")
    assert format_duration(1.5).endswith("s")
    assert "m" in format_duration(90)


def test_format_duration_rejects_negatives():
    with pytest.raises(ValueError):
        format_duration(-1)


def test_stopwatch_accumulates_across_restarts():
    watch = Stopwatch()
    with watch:
        pass
    first_reading = watch.elapsed
    with watch:
        pass
    assert watch.elapsed >= first_reading
    assert watch.reset().elapsed == 0.0


def test_timings_sum_phases():
    timings = Timings()
    timings.record("parse", 0.5)
    timings.record("parse", 0.5)
    timings.record("run", 1.0)
    assert timings.total() == 2.0
    assert "parse=" in timings.describe()


def test_format_caret_points_at_the_column():
    text = format_caret("select x", 1, 8)
    assert text.splitlines()[1].strip() == "^"


def test_format_caret_tolerates_out_of_range_lines():
    assert format_caret("abc", 9, 1) == ""
