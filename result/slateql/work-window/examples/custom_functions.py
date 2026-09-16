"""Extend a session with project-specific scalar and aggregate functions.

Functions are registered on a private registry so that the process-wide default
registry stays untouched.

Run with ``python examples/custom_functions.py`` from the repository root.
"""

from __future__ import annotations

from typing import Any, Sequence

from slateql import Session
from slateql.functions.registry import FunctionRegistry, builtin_registry
from slateql.functions.signature import (
    AggregateFunctionDef,
    Arity,
    ScalarFunctionDef,
    fixed_type,
)
from slateql.types.datatypes import DOUBLE, STRING


def initials(args: Sequence[Any]) -> str:
    """Reduce a full name to its initials: ``Ann Berg`` -> ``A.B.``"""

    parts = [part for part in str(args[0]).split() if part]
    return "".join(f"{part[0].upper()}." for part in parts)


class MedianAccumulator:
    """Collects values and returns the median at the end of the group."""

    def __init__(self) -> None:
        self._values: list[float] = []

    def update(self, values: Sequence[Any]) -> None:
        value = values[0] if values else None
        if value is not None:
            self._values.append(float(value))

    def result(self) -> float | None:
        if not self._values:
            return None
        ordered = sorted(self._values)
        middle = len(ordered) // 2
        if len(ordered) % 2 == 1:
            return ordered[middle]
        return (ordered[middle - 1] + ordered[middle]) / 2


def build_registry() -> FunctionRegistry:
    registry = builtin_registry()
    registry.register_scalar(
        ScalarFunctionDef(
            name="initials",
            arity=Arity.exactly(1),
            resolve_type=fixed_type(STRING),
            evaluate=initials,
            description="Reduce a name to dotted initials",
        )
    )
    registry.register_aggregate(
        AggregateFunctionDef(
            name="median",
            arity=Arity.exactly(1),
            resolve_type=fixed_type(DOUBLE),
            factory=lambda _: MedianAccumulator(),
            description="Middle value of a group",
        )
    )
    return registry


PEOPLE = [
    {"name": "Ann Berg", "team": "core", "score": 8.0},
    {"name": "Bo Chen", "team": "core", "score": 6.0},
    {"name": "Cy Dunn", "team": "core", "score": 9.0},
    {"name": "Di Ellis", "team": "growth", "score": 4.0},
    {"name": "Eve Foss", "team": "growth", "score": 7.0},
]


def main() -> None:
    session = Session(registry=build_registry())
    session.register_dicts("people", PEOPLE)

    print("Custom scalar function")
    print(
        session.sql(
            "SELECT name, INITIALS(name) AS short FROM people ORDER BY name"
        ).pretty()
    )

    print("\nCustom aggregate function")
    print(
        session.sql(
            "SELECT team, MEDIAN(score) AS median_score, COUNT(*) AS members "
            "FROM people GROUP BY team ORDER BY team"
        ).pretty()
    )

    print("\nThe default registry is untouched:")
    default = Session()
    default.register_dicts("people", PEOPLE)
    try:
        default.sql("SELECT INITIALS(name) FROM people")
    except Exception as error:  # noqa: BLE001 - demonstrating the failure
        print(f"  {error}")


if __name__ == "__main__":
    main()
