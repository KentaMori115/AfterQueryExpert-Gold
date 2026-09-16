"""A tour of the engine in one runnable script.

Run it from the repository root::

    python examples/quickstart.py

Every section prints a heading, the SQL it ran and the rows that came back.
Nothing here is test infrastructure; it is the shortest honest demonstration
of what the engine does.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "src"))

from veldt import Engine  # noqa: E402
from veldt.cli.formatting import render_table  # noqa: E402

DATA = os.path.join(os.path.dirname(__file__), "data")


def show(engine: Engine, title: str, sql: str) -> None:
    """Run one statement and print it with its result."""
    print(f"\n=== {title} ===")
    print(" ".join(sql.split()))
    print(render_table(engine.sql(sql).table))


def main() -> int:
    """Run the tour."""
    engine = Engine()
    engine.register_csv("trips", os.path.join(DATA, "trips.csv"))
    engine.register_csv("drivers", os.path.join(DATA, "drivers.csv"))

    print("Registered tables:", ", ".join(engine.tables()))
    print("\ntrips schema:")
    print(engine.schema("trips").describe())

    show(
        engine,
        "Filtering and ordering",
        """
        SELECT trip_id, driver, fare
        FROM trips
        WHERE status = 'completed' AND fare > 15
        ORDER BY fare DESC
        """,
    )

    show(
        engine,
        "Grouping with a HAVING clause",
        """
        SELECT driver,
               count(*) AS trips,
               round(sum(fare), 2) AS revenue,
               round(avg(fare), 2) AS average
        FROM trips
        WHERE status = 'completed'
        GROUP BY driver
        HAVING count(*) > 1
        ORDER BY revenue DESC
        """,
    )

    show(
        engine,
        "Joining two files",
        """
        SELECT d.driver, d.rating, count(*) AS trips
        FROM trips t
        JOIN drivers d ON t.driver = d.driver
        WHERE t.status = 'completed'
        GROUP BY d.driver, d.rating
        ORDER BY trips DESC, d.driver
        """,
    )

    show(
        engine,
        "An outer join keeps drivers with no match",
        """
        SELECT t.driver, d.home_city
        FROM trips t
        LEFT JOIN drivers d ON t.driver = d.driver
        WHERE d.home_city IS NULL
        """,
    )

    show(
        engine,
        "Expressions, CASE and date parts",
        """
        SELECT driver,
               month(started_at) AS month,
               CASE WHEN fare > 20 THEN 'long' ELSE 'short' END AS kind,
               coalesce(tip, 0) AS tip
        FROM trips
        WHERE status = 'completed'
        ORDER BY driver, trip_id
        LIMIT 6
        """,
    )

    show(
        engine,
        "Set operations",
        """
        SELECT city FROM trips
        UNION
        SELECT home_city FROM drivers
        """,
    )

    show(
        engine,
        "Cities that are both driven to and lived in",
        """
        SELECT city FROM trips
        INTERSECT
        SELECT home_city FROM drivers
        ORDER BY city
        """,
    )

    show(
        engine,
        "Cities nobody drives home to",
        """
        SELECT city FROM trips
        EXCEPT
        SELECT home_city FROM drivers
        ORDER BY city
        """,
    )

    print("\n=== The optimized plan ===")
    print(
        engine.explain(
            """
            SELECT driver, count(*) AS n
            FROM trips
            WHERE fare > 10 AND 1 = 1
            GROUP BY driver
            """
        )
    )

    result = engine.sql("SELECT count(*) AS n FROM trips")
    print("\n=== Execution metrics ===")
    for key in sorted(result.metrics):
        print(f"{key}: {result.metrics[key]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
