"""Register a few rows and run some queries against them.

Run with ``python examples/quickstart.py`` from the repository root.
"""

from __future__ import annotations

from slateql import Session
from slateql.types.datatypes import DOUBLE, INTEGER, STRING
from slateql.types.schema import Schema

PRODUCTS_SCHEMA = Schema.of(
    ("sku", STRING),
    ("category", STRING),
    ("price", DOUBLE),
    ("stock", INTEGER),
)

PRODUCTS = [
    ["kb-01", "input", 49.5, 12],
    ["ms-02", "input", 19.0, 40],
    ["mn-03", "display", 239.0, 5],
    ["dk-04", "hub", 129.0, 0],
    ["cb-05", "cable", 7.25, 220],
    ["mn-06", "display", 319.0, 2],
]


def main() -> None:
    session = Session()
    session.register_rows("products", PRODUCTS_SCHEMA, PRODUCTS)

    print("Everything in stock, cheapest first")
    print(
        session.sql(
            """
            SELECT sku, category, price
            FROM products
            WHERE stock > 0
            ORDER BY price
            """
        ).pretty()
    )

    print("\nInventory value by category")
    print(
        session.sql(
            """
            SELECT category,
                   COUNT(*)                            AS lines,
                   SUM(stock)                          AS units,
                   ROUND(SUM(price * stock), 2)        AS value
            FROM products
            GROUP BY category
            HAVING SUM(stock) > 0
            ORDER BY value DESC
            """
        ).pretty()
    )

    print("\nStock health")
    print(
        session.sql(
            """
            SELECT sku,
                   CASE
                       WHEN stock = 0 THEN 'out'
                       WHEN stock < 10 THEN 'low'
                       ELSE 'ok'
                   END AS health
            FROM products
            ORDER BY health, sku
            """
        ).pretty()
    )

    print("\nPlan for the grouped query")
    print(
        session.explain(
            "SELECT category, SUM(stock) FROM products WHERE stock > 0 GROUP BY category"
        )
    )


if __name__ == "__main__":
    main()
