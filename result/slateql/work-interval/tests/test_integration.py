"""End-to-end tests against the checked-in sample data files."""

from __future__ import annotations

from pathlib import Path

import pytest

from slateql import Session

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


@pytest.fixture()
def loaded() -> Session:
    session = Session()
    session.register_csv("customers", DATA_DIR / "customers.csv")
    session.register_csv("orders", DATA_DIR / "orders.csv")
    session.register_jsonl("events", DATA_DIR / "events.jsonl")
    return session


def test_sample_files_are_discoverable():
    assert (DATA_DIR / "customers.csv").exists()
    assert (DATA_DIR / "orders.csv").exists()
    assert (DATA_DIR / "events.jsonl").exists()


def test_customer_schema_is_inferred(loaded: Session):
    types = [field.dtype.name for field in loaded.schema_of("customers")]
    assert types == ["INTEGER", "STRING", "STRING", "DATE", "BOOLEAN"]


def test_event_schema_is_inferred(loaded: Session):
    types = [field.dtype.name for field in loaded.schema_of("events")]
    assert types == ["INTEGER", "INTEGER", "STRING", "TIMESTAMP", "DOUBLE"]


def test_revenue_by_city(loaded: Session):
    result = loaded.sql(
        """
        SELECT c.city AS city,
               COUNT(*) AS order_count,
               ROUND(SUM(o.quantity * o.unit_price), 2) AS revenue
        FROM customers c
        JOIN orders o ON o.customer_id = c.id
        GROUP BY c.city
        ORDER BY revenue DESC, city
        """
    )
    assert result.columns == ["city", "order_count", "revenue"]
    assert result.rows[0][0] == "Rome"
    assert sum(row[1] for row in result.rows) == 10


def test_customers_without_orders(loaded: Session):
    result = loaded.sql(
        """
        SELECT c.name AS name
        FROM customers c
        LEFT JOIN orders o ON o.customer_id = c.id
        WHERE o.order_id IS NULL
        ORDER BY c.name
        """
    )
    assert result.column("name") == ["Fay Gray"]


def test_orphan_order_is_visible_through_a_right_join(loaded: Session):
    result = loaded.sql(
        """
        SELECT o.order_id AS order_id
        FROM customers c
        RIGHT JOIN orders o ON o.customer_id = c.id
        WHERE c.id IS NULL
        """
    )
    assert result.column("order_id") == [110]


def test_event_weights_by_kind(loaded: Session):
    result = loaded.sql(
        "SELECT kind, COUNT(*) AS n, SUM(weight) AS total "
        "FROM events GROUP BY kind ORDER BY total DESC, kind"
    )
    assert result.rows[0][0] == "purchase"
    assert result.rows[-1][0] == "refund"


def test_date_functions_over_real_dates(loaded: Session):
    result = loaded.sql(
        "SELECT EXTRACT('month', signup_date) AS month, COUNT(*) AS n "
        "FROM customers GROUP BY EXTRACT('month', signup_date) ORDER BY month"
    )
    assert result.rows[0] == [1, 1]


def test_timestamp_truncation_over_events(loaded: Session):
    result = loaded.sql(
        "SELECT DATE_TRUNC('day', at) AS day, COUNT(*) AS n "
        "FROM events GROUP BY DATE_TRUNC('day', at) ORDER BY day"
    )
    assert len(result) == 7


def test_three_way_join_across_formats(loaded: Session):
    result = loaded.sql(
        """
        SELECT c.name AS name, COUNT(*) AS touches
        FROM customers c
        JOIN orders o ON o.customer_id = c.id
        JOIN events e ON e.customer_id = c.id
        GROUP BY c.name
        HAVING COUNT(*) > 2
        ORDER BY touches DESC, name
        """
    )
    assert result.rows[0][1] >= 3


def test_union_across_sources(loaded: Session):
    result = loaded.sql(
        "SELECT customer_id FROM orders UNION SELECT customer_id FROM events"
    )
    assert len(result) == 8


def test_optimized_and_unoptimized_agree_on_the_sample_data(loaded: Session):
    statement = (
        "SELECT c.city AS city, COUNT(*) AS n FROM customers c "
        "JOIN orders o ON o.customer_id = c.id "
        "WHERE o.quantity > 1 GROUP BY c.city ORDER BY city"
    )
    fast = loaded.sql(statement).to_tuples()
    loaded.configure(optimize=False)
    slow = loaded.sql(statement).to_tuples()
    assert fast == slow


def test_explain_mentions_the_pushed_filter(loaded: Session):
    text = loaded.explain("SELECT name FROM customers WHERE city = 'Oslo'")
    assert "filter=" in text


def test_analyze_then_plan_uses_statistics(loaded: Session):
    loaded.analyze()
    stats = loaded.catalog.get("orders").statistics
    assert stats is not None and stats.row_count == 11
