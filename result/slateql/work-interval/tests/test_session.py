"""Tests for the public Session API."""

from __future__ import annotations

from pathlib import Path

import pytest

from slateql import Session, SessionConfig
from slateql.errors import SlateQLError, UnknownTableError
from slateql.types.datatypes import INTEGER, STRING
from slateql.types.schema import Schema


def test_register_rows_and_query(empty_session):
    empty_session.register_rows(
        "t", Schema.of(("a", INTEGER), ("b", STRING)), [[1, "x"], [2, "y"]]
    )
    assert empty_session.sql("SELECT b FROM t WHERE a = 2").scalar() == "y"


def test_register_dicts_infers_a_schema(empty_session):
    empty_session.register_dicts("t", [{"a": 1}, {"a": 2}])
    assert empty_session.schema_of("t").names == ["a"]


def test_register_csv(empty_session, csv_path: Path):
    empty_session.register_csv("sample", csv_path)
    assert empty_session.sql("SELECT COUNT(*) FROM sample").scalar() == 3


def test_register_jsonl(empty_session, jsonl_path: Path):
    empty_session.register_jsonl("sample", jsonl_path)
    assert empty_session.sql("SELECT COUNT(score) FROM sample").scalar() == 2


def test_registering_twice_replaces_the_table(empty_session):
    empty_session.register_dicts("t", [{"a": 1}])
    empty_session.register_dicts("t", [{"a": 1}, {"a": 2}])
    assert empty_session.sql("SELECT COUNT(*) FROM t").scalar() == 2


def test_drop_removes_a_table(empty_session):
    empty_session.register_dicts("t", [{"a": 1}])
    assert empty_session.drop("t") is True
    with pytest.raises(UnknownTableError):
        empty_session.sql("SELECT * FROM t")


def test_tables_are_listed_alphabetically(empty_session):
    empty_session.register_dicts("zebra", [{"a": 1}])
    empty_session.register_dicts("apple", [{"a": 1}])
    assert empty_session.tables() == ["apple", "zebra"]


def test_query_returns_dictionaries(session):
    records = session.query("SELECT id FROM customers ORDER BY id LIMIT 1")
    assert records == [{"id": 1}]


def test_scalar_requires_one_cell(session):
    with pytest.raises(SlateQLError):
        session.scalar("SELECT id FROM customers")


def test_result_column_lookup(session):
    result = session.sql("SELECT id, name FROM customers ORDER BY id LIMIT 2")
    assert result.column("name") == ["Ann Berg", "Bo Chen"]


def test_result_pretty_prints_a_table(session):
    text = session.sql("SELECT id FROM customers ORDER BY id LIMIT 1").pretty()
    assert "| id |" in text


def test_result_metrics_are_reported(session):
    result = session.sql("SELECT id FROM customers")
    assert result.metrics["rows_scanned"] == 6


def test_explain_renders_a_tree(session):
    text = session.explain("SELECT id FROM customers WHERE id > 1")
    assert text.splitlines()[0].startswith("Project") or text.startswith("Scan")


def test_explain_verbose_includes_the_physical_plan(session):
    text = session.explain("SELECT id FROM customers", verbose=True)
    assert "Physical:" in text
    assert "Unoptimized:" in text


def test_explain_statement_returns_rows(session):
    result = session.sql("EXPLAIN SELECT id FROM customers")
    assert result.schema.names == ["plan"]
    assert len(result) >= 1


def test_show_tables(session):
    result = session.sql("SHOW TABLES")
    assert "customers" in result.column("table_name")


def test_show_columns(session):
    result = session.sql("SHOW COLUMNS FROM customers")
    assert result.column("column_name")[0] == "id"


def test_describe_is_a_synonym_for_show_columns(session):
    assert session.sql("DESCRIBE customers").to_tuples() == session.sql(
        "SHOW COLUMNS FROM customers"
    ).to_tuples()


def test_analyze_reports_row_counts(session):
    counts = session.analyze()
    assert counts["customers"] == 6


def test_analyze_one_table(session):
    assert session.analyze("orders") == {"orders": 8}


def test_configure_returns_the_session(session):
    assert session.configure(batch_size=16) is session
    assert session.config.batch_size == 16


def test_session_accepts_a_custom_config():
    config = SessionConfig(batch_size=2, null_ordering="nulls_first")
    active = Session(config=config)
    assert active.config.nulls_first_default


def test_null_ordering_default_applies_to_order_by():
    config = SessionConfig(null_ordering="nulls_first")
    active = Session(config=config)
    active.register_dicts("t", [{"a": 1}, {"a": None}])
    assert active.sql("SELECT a FROM t ORDER BY a").column("a")[0] is None


def test_union_removes_duplicates(session):
    result = session.sql(
        "SELECT city FROM customers UNION SELECT city FROM customers"
    )
    assert len(result) == 4


def test_union_all_keeps_duplicates(session):
    result = session.sql(
        "SELECT city FROM customers UNION ALL SELECT city FROM customers"
    )
    assert len(result) == 12


def test_union_coerces_column_types(session):
    result = session.sql(
        "SELECT id FROM customers UNION ALL SELECT unit_price FROM orders"
    )
    assert all(isinstance(row[0], float) for row in result.rows)


def test_union_with_order_by_and_limit(session):
    result = session.sql(
        "SELECT id FROM customers UNION ALL SELECT order_id FROM orders "
        "ORDER BY id DESC LIMIT 2"
    )
    assert result.column("id") == [107, 106]


def test_version_is_exposed():
    import slateql

    assert slateql.__version__
    assert slateql.version_tuple()[0] >= 0
