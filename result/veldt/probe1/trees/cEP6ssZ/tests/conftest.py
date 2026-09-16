"""Shared fixtures for the test suite."""

from __future__ import annotations

import os
import sys
from datetime import datetime

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "src"))

from veldt import Engine  # noqa: E402
from veldt.core.table import Table  # noqa: E402
from veldt.storage.catalog import Catalog  # noqa: E402
from veldt.storage.memory import MemorySource  # noqa: E402
from veldt.types.dtypes import DataType  # noqa: E402
from veldt.types.schema import Field, Schema  # noqa: E402

ORDER_ROWS = [
    {"id": 1, "customer": "ann", "region": "eu", "amount": 120.0, "status": "paid"},
    {"id": 2, "customer": "bob", "region": "us", "amount": 40.5, "status": "paid"},
    {"id": 3, "customer": "ann", "region": "eu", "amount": None, "status": "pending"},
    {"id": 4, "customer": "cy", "region": "us", "amount": 80.0, "status": "cancelled"},
    {"id": 5, "customer": "bob", "region": "eu", "amount": 15.25, "status": "paid"},
    {"id": 6, "customer": "dee", "region": "ap", "amount": 200.0, "status": "pending"},
]

CUSTOMER_ROWS = [
    {"customer": "ann", "tier": "gold", "since": datetime(2024, 1, 5)},
    {"customer": "bob", "tier": "silver", "since": datetime(2025, 6, 30)},
    {"customer": "cy", "tier": None, "since": datetime(2026, 2, 14)},
]


@pytest.fixture
def order_schema() -> Schema:
    """The schema used by the ``orders`` fixtures."""
    return Schema(
        [
            Field("id", DataType.INT64, nullable=False),
            Field("customer", DataType.STRING),
            Field("region", DataType.STRING),
            Field("amount", DataType.FLOAT64),
            Field("status", DataType.STRING),
        ]
    )


@pytest.fixture
def orders(order_schema: Schema) -> Table:
    """A small orders table with one null amount."""
    return Table.from_dicts(ORDER_ROWS, order_schema)


@pytest.fixture
def customers() -> Table:
    """A customers table that does not cover every order."""
    return Table.from_dicts(CUSTOMER_ROWS)


@pytest.fixture
def catalog(orders: Table, customers: Table) -> Catalog:
    """A catalog holding both fixture tables."""
    registry = Catalog()
    registry.register("orders", MemorySource("orders", orders))
    registry.register("customers", MemorySource("customers", customers))
    return registry


@pytest.fixture
def engine(catalog: Catalog) -> Engine:
    """An engine over the fixture catalog."""
    return Engine(catalog)


@pytest.fixture
def orders_csv(tmp_path, orders: Table) -> str:
    """The orders table written out as a CSV file."""
    from veldt.io.writers import write_csv

    path = os.path.join(str(tmp_path), "orders.csv")
    write_csv(orders, path)
    return path


@pytest.fixture
def orders_jsonl(tmp_path, orders: Table) -> str:
    """The orders table written out as JSON Lines."""
    from veldt.io.writers import write_jsonl

    path = os.path.join(str(tmp_path), "orders.jsonl")
    write_jsonl(orders, path)
    return path


@pytest.fixture
def partitioned_root(tmp_path) -> str:
    """A hive-style partitioned directory with two partition keys."""
    root = os.path.join(str(tmp_path), "events")
    layout = {
        ("eu", "2026-05-01"): "id,amount\n1,10\n2,20\n",
        ("eu", "2026-05-02"): "id,amount\n3,30\n",
        ("us", "2026-05-01"): "id,amount\n4,40\n5,50\n",
    }
    for (region, day), body in layout.items():
        directory = os.path.join(root, f"region={region}", f"day={day}")
        os.makedirs(directory, exist_ok=True)
        with open(os.path.join(directory, "part-0.csv"), "w", encoding="utf-8") as handle:
            handle.write(body)
    return root
