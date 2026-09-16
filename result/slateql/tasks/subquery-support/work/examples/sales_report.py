"""Join the sample CSV and JSONL files into a small report.

Run with ``python examples/sales_report.py`` from the repository root.
"""

from __future__ import annotations

from pathlib import Path

from slateql import Session

DATA = Path(__file__).resolve().parent.parent / "data"


def build_session() -> Session:
    session = Session()
    session.register_csv("customers", DATA / "customers.csv")
    session.register_csv("orders", DATA / "orders.csv")
    session.register_jsonl("events", DATA / "events.jsonl")
    return session


REVENUE_BY_CITY = """
SELECT c.city                                     AS city,
       COUNT(*)                                   AS order_count,
       ROUND(SUM(o.quantity * o.unit_price), 2)   AS revenue,
       ROUND(AVG(o.quantity * o.unit_price), 2)   AS average_order
FROM customers c
JOIN orders o ON o.customer_id = c.id
GROUP BY c.city
ORDER BY revenue DESC, city
"""

TOP_PRODUCTS = """
SELECT product,
       SUM(quantity)                             AS units,
       ROUND(SUM(quantity * unit_price), 2)      AS revenue
FROM orders
GROUP BY product
ORDER BY revenue DESC
LIMIT 3
"""

DORMANT_CUSTOMERS = """
SELECT c.name AS name, c.city AS city
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
WHERE o.order_id IS NULL
ORDER BY c.name
"""

ORPHANED_ORDERS = """
SELECT o.order_id AS order_id, o.product AS product
FROM customers c
RIGHT JOIN orders o ON o.customer_id = c.id
WHERE c.id IS NULL
"""

EVENT_MIX = """
SELECT kind,
       COUNT(*)                  AS events,
       ROUND(SUM(weight), 2)     AS weight
FROM events
GROUP BY kind
ORDER BY weight DESC, kind
"""

SIGNUP_MONTHS = """
SELECT EXTRACT('month', signup_date) AS month,
       COUNT(*)                      AS signups
FROM customers
GROUP BY EXTRACT('month', signup_date)
ORDER BY month
"""


def main() -> None:
    session = build_session()
    sections = [
        ("Revenue by city", REVENUE_BY_CITY),
        ("Top products", TOP_PRODUCTS),
        ("Customers with no orders", DORMANT_CUSTOMERS),
        ("Orders with no customer", ORPHANED_ORDERS),
        ("Event mix", EVENT_MIX),
        ("Signups by month", SIGNUP_MONTHS),
    ]
    for title, statement in sections:
        print(f"== {title}")
        print(session.sql(statement).pretty())
        print()

    session.analyze()
    print("== Table statistics")
    for name in session.tables():
        print(f"{name}:")
        print(session.catalog.get(name).statistics.describe())
        print()


if __name__ == "__main__":
    main()
