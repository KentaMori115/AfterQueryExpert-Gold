"""Calendar arithmetic with INTERVAL values.

Run with ``python examples/intervals.py`` from the repository root.  The
script registers a handful of subscriptions and asks the questions a billing
job asks: when does each one renew, how long has it been running, and what is
the mean term.
"""

from __future__ import annotations

import datetime as dt

from slateql import Session
from slateql.types.datatypes import DATE, INTEGER, INTERVAL, STRING
from slateql.types.interval import Interval
from slateql.types.schema import Schema

SUBSCRIPTIONS_SCHEMA = Schema.of(
    ("id", INTEGER),
    ("plan", STRING),
    ("started", DATE),
    ("term", INTERVAL),
)

SUBSCRIPTIONS = [
    [1, "monthly", dt.date(2024, 1, 31), Interval.parse("P1M")],
    [2, "monthly", dt.date(2024, 1, 29), Interval.parse("P1M")],
    [3, "quarterly", dt.date(2023, 11, 30), Interval.parse("P3M")],
    [4, "trial", dt.date(2024, 2, 20), Interval.parse("P14D")],
    [5, "annual", dt.date(2024, 2, 29), Interval.parse("P1Y")],
]


def main() -> None:
    session = Session()
    session.register_rows("subscriptions", SUBSCRIPTIONS_SCHEMA, SUBSCRIPTIONS)

    print("Renewal dates walk the calendar and clamp to the month end:")
    print(
        session.sql(
            "SELECT id, plan, started, term, started + term AS renews "
            "FROM subscriptions ORDER BY renews"
        ).pretty()
    )

    print("A month compares as thirty days, so terms sort and group by length:")
    print(
        session.sql(
            "SELECT term, COUNT(*) AS n FROM subscriptions "
            "GROUP BY term ORDER BY term"
        ).pretty()
    )

    print("Half a term, and the mean term:")
    print(
        session.sql(
            "SELECT MIN(term / 2) AS shortest_half, AVG(term) AS mean_term "
            "FROM subscriptions"
        ).pretty()
    )

    print("Elapsed time is a timestamp difference:")
    print(
        session.sql(
            "SELECT id, CAST('2024-03-15T12:00:00' AS TIMESTAMP) - started AS running "
            "FROM subscriptions ORDER BY id"
        ).pretty()
    )


if __name__ == "__main__":
    main()
