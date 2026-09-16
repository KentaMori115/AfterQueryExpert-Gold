"""Conditional and null-handling scalar functions.

These are the functions that must *not* propagate NULL automatically, since
inspecting NULL is their entire purpose.
"""

from __future__ import annotations

from typing import Any, Sequence

from ..types.coercion import unify
from ..types.datatypes import BOOLEAN, DataType
from .signature import Arity, ScalarFunctionDef, fixed_type

__all__ = ["register"]


def _coalesce(args: Sequence[Any]) -> Any:
    for value in args:
        if value is not None:
            return value
    return None


def _nullif(args: Sequence[Any]) -> Any:
    left, right = args[0], args[1]
    if left is None:
        return None
    if right is not None and left == right:
        return None
    return left


def _ifnull(args: Sequence[Any]) -> Any:
    return args[1] if args[0] is None else args[0]


def _is_null(args: Sequence[Any]) -> bool:
    return args[0] is None


def _if(args: Sequence[Any]) -> Any:
    return args[1] if args[0] is True else args[2]


def _coalesce_type(args: Sequence[DataType]) -> DataType:
    if not args:
        from ..types.datatypes import NULL

        return NULL
    unified = unify(args, context="coalesce()")
    nullable = all(arg.nullable or arg.is_null for arg in args)
    return unified.as_nullable(nullable)


def _nullif_type(args: Sequence[DataType]) -> DataType:
    return args[0].as_nullable(True)


def _if_type(args: Sequence[DataType]) -> DataType:
    return unify(args[1:], context="if()")


def register(registry: Any) -> None:
    """Add every conditional function to ``registry``."""

    def scalar(
        name: str,
        arity: Arity,
        resolver: Any,
        impl: Any,
        description: str,
        *aliases: str,
    ) -> None:
        registry.register_scalar(
            ScalarFunctionDef(
                name=name,
                arity=arity,
                resolve_type=resolver,
                evaluate=impl,
                description=description,
                propagates_null=False,
            ),
            *aliases,
        )

    scalar(
        "coalesce",
        Arity.at_least(1),
        _coalesce_type,
        _coalesce,
        "First non-null argument",
    )
    scalar("nullif", Arity.exactly(2), _nullif_type, _nullif, "NULL when both are equal")
    scalar("ifnull", Arity.exactly(2), _coalesce_type, _ifnull, "Replace NULL", "nvl")
    scalar(
        "is_null",
        Arity.exactly(1),
        fixed_type(BOOLEAN.as_nullable(False)),
        _is_null,
        "Null test as a function",
    )
    scalar("if", Arity.exactly(3), _if_type, _if, "Three-argument conditional")
