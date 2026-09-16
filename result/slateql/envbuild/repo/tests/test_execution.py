"""End-to-end execution tests: filtering, projection, ordering, limits."""

from __future__ import annotations

import pytest

from slateql.errors import ExecutionError
from slateql.execution.batch import RecordBatch, batches_from_rows, concat_batches
from slateql.execution.keys import row_key, value_key
from slateql.types.datatypes import INTEGER
from slateql.types.schema import Schema


def test_batch_rejects_rows_of_the_wrong_width():
    with pytest.raises(ExecutionError):
        RecordBatch(schema=Schema.of(("a", INTEGER)), rows=[[1, 2]])


def test_batches_from_rows_splits_evenly():
    schema = Schema.of(("a", INTEGER))
    batches = list(batches_from_rows(schema, [[i] for i in range(5)], 2))
    assert [len(batch) for batch in batches] == [2, 2, 1]


def test_batches_from_empty_input_yields_nothing():
    schema = Schema.of(("a", INTEGER))
    assert list(batches_from_rows(schema, [], 2)) == []


def test_concat_batches_merges_rows():
    schema = Schema.of(("a", INTEGER))
    merged = concat_batches(schema, list(batches_from_rows(schema, [[1], [2]], 1)))
    assert merged.rows == [[1], [2]]


def test_booleans_and_integers_are_distinct_keys():
    assert value_key(True) != value_key(1)
    assert row_key([None]) == row_key([None])


def test_select_all_rows(session):
    assert len(session.sql("SELECT * FROM customers")) == 6


def test_where_drops_null_predicates(session):
    result = session.sql("SELECT id FROM customers WHERE city = 'Oslo'")
    assert result.column("id") == [1, 3]


def test_where_with_is_null(session):
    result = session.sql("SELECT id FROM customers WHERE city IS NULL")
    assert result.column("id") == [6]


def test_projection_computes_expressions(session):
    result = session.sql("SELECT id * 2 AS doubled FROM customers WHERE id = 3")
    assert result.scalar() == 6


def test_order_by_ascending_puts_nulls_last_by_default(session):
    result = session.sql("SELECT city FROM customers ORDER BY city")
    assert result.column("city")[-1] is None


def test_order_by_nulls_first(session):
    result = session.sql("SELECT city FROM customers ORDER BY city NULLS FIRST")
    assert result.column("city")[0] is None


def test_order_by_descending_still_puts_nulls_last(session):
    result = session.sql("SELECT city FROM customers ORDER BY city DESC")
    assert result.column("city")[-1] is None


def test_order_by_is_stable_for_equal_keys(session):
    result = session.sql("SELECT id, city FROM customers ORDER BY city")
    oslo = [row[0] for row in result.rows if row[1] == "Oslo"]
    assert oslo == [1, 3]


def test_order_by_multiple_keys(session):
    result = session.sql(
        "SELECT customer_id, order_id FROM orders ORDER BY customer_id, order_id DESC"
    )
    assert result.rows[0] == [1, 101]


def test_limit_and_offset(session):
    result = session.sql("SELECT id FROM customers ORDER BY id LIMIT 2 OFFSET 2")
    assert result.column("id") == [3, 4]


def test_limit_zero_returns_nothing(session):
    assert session.sql("SELECT id FROM customers LIMIT 0").is_empty


def test_offset_beyond_the_end_returns_nothing(session):
    assert session.sql("SELECT id FROM customers LIMIT 5 OFFSET 99").is_empty


def test_distinct_removes_duplicates_and_keeps_nulls(session):
    result = session.sql("SELECT DISTINCT city FROM customers ORDER BY city")
    assert result.column("city") == ["Lima", "Oslo", "Rome", None]


def test_distinct_over_several_columns(session):
    result = session.sql("SELECT DISTINCT city, active FROM customers")
    assert sorted(result.to_tuples(), key=lambda row: (row[0] or "", row[1])) == [
        (None, False),
        ("Lima", True),
        ("Oslo", False),
        ("Oslo", True),
        ("Rome", True),
    ]


def test_select_without_from_evaluates_constants(empty_session):
    assert empty_session.sql("SELECT 1 + 1 AS two").scalar() == 2


def test_case_expression(session):
    result = session.sql(
        "SELECT CASE WHEN active THEN 'yes' ELSE 'no' END AS flag "
        "FROM customers ORDER BY id LIMIT 1"
    )
    assert result.scalar() == "yes"


def test_like_matching(session):
    result = session.sql("SELECT name FROM customers WHERE name LIKE 'B%'")
    assert result.column("name") == ["Bo Chen"]


def test_in_list(session):
    result = session.sql("SELECT id FROM customers WHERE id IN (1, 4) ORDER BY id")
    assert result.column("id") == [1, 4]


def test_string_functions_apply_per_row(session):
    result = session.sql(
        "SELECT UPPER(city) AS c FROM customers WHERE id = 1"
    )
    assert result.scalar() == "OSLO"


def test_division_by_zero_surfaces_as_an_execution_error(session):
    with pytest.raises(ExecutionError):
        session.sql("SELECT id / 0 FROM customers")


def test_max_rows_budget_is_enforced(session):
    session.configure(max_rows=2)
    with pytest.raises(ExecutionError):
        session.sql("SELECT id FROM customers")


def test_batch_size_does_not_change_results(session):
    reference = session.sql("SELECT id FROM customers ORDER BY id").to_tuples()
    session.configure(batch_size=1)
    assert session.sql("SELECT id FROM customers ORDER BY id").to_tuples() == reference


def test_repeated_execution_is_deterministic(session):
    statement = "SELECT city, COUNT(*) AS n FROM customers GROUP BY city ORDER BY city"
    first = session.sql(statement).to_tuples()
    for _ in range(3):
        assert session.sql(statement).to_tuples() == first


def test_order_by_an_aggregate_that_shadows_an_input_column(session):
    result = session.sql(
        "SELECT k, SUM(v) AS v FROM nullable GROUP BY k ORDER BY v DESC NULLS LAST"
    )
    assert result.column("k")[0] is None
