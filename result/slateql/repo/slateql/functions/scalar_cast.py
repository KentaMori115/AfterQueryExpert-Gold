"""Explicit conversion functions.

``CAST(x AS t)`` is handled by the plan's :class:`~slateql.plan.CastExpr`, but
the equivalent functions are registered too so that conversions can be written
in a call style and composed like any other function.
"""

from __future__ import annotations

from typing import Any, Sequence

from ..types.datatypes import (
    BOOLEAN,
    DATE,
    DOUBLE,
    INTEGER,
    STRING,
    TIMESTAMP,
    DataType,
)
from ..types.values import cast_value
from .signature import Arity, ScalarFunctionDef, fixed_type

__all__ = ["register"]


def _make_cast(target: DataType) -> Any:
    def _impl(args: Sequence[Any]) -> Any:
        return cast_value(args[0], target)

    return _impl


def _typeof(args: Sequence[Any]) -> str:
    from ..types.datatypes import type_from_python

    return type_from_python(args[0]).name


def register(registry: Any) -> None:
    """Add every conversion function to ``registry``."""

    conversions = {
        "to_string": STRING,
        "to_integer": INTEGER,
        "to_double": DOUBLE,
        "to_boolean": BOOLEAN,
        "to_timestamp": TIMESTAMP,
        "to_date_strict": DATE,
    }
    aliases = {
        "to_string": ("str",),
        "to_integer": ("int",),
        "to_double": ("float",),
        "to_boolean": ("bool",),
    }
    for name, target in conversions.items():
        registry.register_scalar(
            ScalarFunctionDef(
                name=name,
                arity=Arity.exactly(1),
                resolve_type=fixed_type(target.as_nullable(True)),
                evaluate=_make_cast(target),
                description=f"Convert a value to {target.name}",
            ),
            *aliases.get(name, ()),
        )
    registry.register_scalar(
        ScalarFunctionDef(
            name="typeof",
            arity=Arity.exactly(1),
            resolve_type=fixed_type(STRING.as_nullable(False)),
            evaluate=_typeof,
            description="Name of a value's runtime type",
            propagates_null=False,
        )
    )
