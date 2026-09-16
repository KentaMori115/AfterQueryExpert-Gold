"""Shared fixtures for the SlateQL test suite."""

from __future__ import annotations

import datetime as dt
from pathlib import Path

import pytest

from slateql import Session
from slateql.types.datatypes import BOOLEAN, DATE, DOUBLE, INTEGER, STRING
from slateql.types.schema import Schema

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

CUSTOMERS_SCHEMA = Schema.of(
    ("id", INTEGER),
    ("name", STRING),
    ("city", STRING),
    ("signup_date", DATE),
    ("active", BOOLEAN),
)

CUSTOMERS_ROWS = [
    [1, "Ann Berg", "Oslo", dt.date(2024, 1, 15), True],
    [2, "Bo Chen", "Rome", dt.date(2024, 2, 3), True],
    [3, "Cy Dunn", "Oslo", dt.date(2024, 2, 19), False],
    [4, "Di Ellis", "Lima", dt.date(2024, 3, 8), True],
    [5, "Eve Foss", "Rome", dt.date(2024, 3, 22), True],
    [6, "Fay Gray", None, dt.date(2024, 4, 11), False],
]

ORDERS_SCHEMA = Schema.of(
    ("order_id", INTEGER),
    ("customer_id", INTEGER),
    ("product", STRING),
    ("quantity", INTEGER),
    ("unit_price", DOUBLE),
)

ORDERS_ROWS = [
    [100, 1, "keyboard", 2, 49.5],
    [101, 1, "mouse", 1, 19.0],
    [102, 2, "monitor", 1, 239.0],
    [103, 3, "keyboard", 1, 49.5],
    [104, 4, "cable", 5, 7.25],
    [105, 5, "monitor", 2, 239.0],
    [106, 5, "mouse", 3, 19.0],
    [107, 99, "ghost", 1, 1.0],
]

NULLABLE_SCHEMA = Schema.of(("k", STRING), ("v", INTEGER))

NULLABLE_ROWS = [
    ["a", 1],
    ["a", None],
    ["b", 3],
    [None, 4],
    ["b", None],
]


@pytest.fixture()
def session() -> Session:
    """A session preloaded with the standard in-memory fixtures."""

    active = Session()
    active.register_rows("customers", CUSTOMERS_SCHEMA, CUSTOMERS_ROWS)
    active.register_rows("orders", ORDERS_SCHEMA, ORDERS_ROWS)
    active.register_rows("nullable", NULLABLE_SCHEMA, NULLABLE_ROWS)
    return active


@pytest.fixture()
def empty_session() -> Session:
    """A session with no tables registered."""

    return Session()


@pytest.fixture()
def csv_path(tmp_path: Path) -> Path:
    """A small CSV file covering every inferable type."""

    target = tmp_path / "sample.csv"
    target.write_text(
        "id,label,score,when,flag\n"
        "1,alpha,1.5,2024-01-01,true\n"
        "2,beta,2.5,2024-02-01,false\n"
        "3,gamma,,2024-03-01,true\n",
        encoding="utf-8",
    )
    return target


@pytest.fixture()
def jsonl_path(tmp_path: Path) -> Path:
    """A small JSONL file, including a record with a missing key."""

    target = tmp_path / "sample.jsonl"
    target.write_text(
        '{"id": 1, "label": "alpha", "score": 1.5}\n'
        '{"id": 2, "label": "beta", "score": 2.5}\n'
        '{"id": 3, "label": "gamma"}\n',
        encoding="utf-8",
    )
    return target


def rows_of(session: Session, statement: str) -> list[tuple]:
    """Run ``statement`` and return its rows as tuples."""

    return session.sql(statement).to_tuples()
