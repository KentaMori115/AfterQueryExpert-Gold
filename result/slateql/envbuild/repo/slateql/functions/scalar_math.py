"""Numeric scalar functions."""

from __future__ import annotations

import math
from typing import Any, Sequence

from ..errors import ExecutionError
from ..types.datatypes import DOUBLE, INTEGER, DataType, TypeKind
from .signature import Arity, ScalarFunctionDef, fixed_type

__all__ = ["register", "numeric_result"]


def numeric_result(args: Sequence[DataType]) -> DataType:
    """Preserve INTEGER when every argument is INTEGER, else widen to DOUBLE."""

    nullable = any(arg.nullable or arg.is_null for arg in args)
    if args and all(arg.kind is TypeKind.INTEGER for arg in args):
        return INTEGER.as_nullable(nullable)
    return DOUBLE.as_nullable(nullable)


def _abs(args: Sequence[Any]) -> Any:
    return abs(args[0])


def _sign(args: Sequence[Any]) -> int:
    value = args[0]
    if value > 0:
        return 1
    if value < 0:
        return -1
    return 0


def _ceil(args: Sequence[Any]) -> int:
    return math.ceil(args[0])


def _floor(args: Sequence[Any]) -> int:
    return math.floor(args[0])


def _round(args: Sequence[Any]) -> Any:
    value = args[0]
    digits = int(args[1]) if len(args) > 1 else 0
    if isinstance(value, int) and digits >= 0:
        return value
    result = round(float(value) + 0.0, digits)
    return int(result) if digits <= 0 else result


def _trunc(args: Sequence[Any]) -> Any:
    value = float(args[0])
    digits = int(args[1]) if len(args) > 1 else 0
    factor = 10.0**digits
    truncated = math.trunc(value * factor) / factor
    return int(truncated) if digits <= 0 else truncated


def _sqrt(args: Sequence[Any]) -> float:
    value = float(args[0])
    if value < 0:
        raise ExecutionError("sqrt() of a negative number is undefined")
    return math.sqrt(value)


def _power(args: Sequence[Any]) -> float:
    try:
        return float(args[0]) ** float(args[1])
    except (OverflowError, ValueError) as exc:
        raise ExecutionError(f"power() overflowed: {exc}") from exc


def _exp(args: Sequence[Any]) -> float:
    try:
        return math.exp(float(args[0]))
    except OverflowError as exc:
        raise ExecutionError("exp() overflowed") from exc


def _ln(args: Sequence[Any]) -> float:
    value = float(args[0])
    if value <= 0:
        raise ExecutionError("ln() requires a strictly positive argument")
    return math.log(value)


def _log(args: Sequence[Any]) -> float:
    if len(args) == 1:
        value = float(args[0])
        if value <= 0:
            raise ExecutionError("log() requires a strictly positive argument")
        return math.log10(value)
    base = float(args[0])
    value = float(args[1])
    if base <= 0 or base == 1 or value <= 0:
        raise ExecutionError("log(base, value) requires positive arguments")
    return math.log(value, base)


def _mod(args: Sequence[Any]) -> Any:
    divisor = args[1]
    if divisor == 0:
        raise ExecutionError("division by zero in mod()")
    left, right = args[0], divisor
    result = math.fmod(float(left), float(right))
    if isinstance(left, int) and isinstance(right, int):
        return int(result)
    return result


def _greatest(args: Sequence[Any]) -> Any:
    present = [value for value in args if value is not None]
    return max(present) if present else None


def _least(args: Sequence[Any]) -> Any:
    present = [value for value in args if value is not None]
    return min(present) if present else None


def register(registry: Any) -> None:
    """Add every math function to ``registry``."""

    double_type = fixed_type(DOUBLE)
    integer_type = fixed_type(INTEGER)

    def scalar(
        name: str,
        arity: Arity,
        resolver: Any,
        impl: Any,
        description: str,
        *,
        propagates_null: bool = True,
    ) -> None:
        registry.register_scalar(
            ScalarFunctionDef(
                name=name,
                arity=arity,
                resolve_type=resolver,
                evaluate=impl,
                description=description,
                propagates_null=propagates_null,
            )
        )

    scalar("abs", Arity.exactly(1), numeric_result, _abs, "Absolute value")
    scalar("sign", Arity.exactly(1), integer_type, _sign, "-1, 0 or 1")
    scalar("ceil", Arity.exactly(1), integer_type, _ceil, "Round toward +infinity")
    scalar("floor", Arity.exactly(1), integer_type, _floor, "Round toward -infinity")
    scalar("round", Arity.between(1, 2), numeric_result, _round, "Round to digits")
    scalar("trunc", Arity.between(1, 2), numeric_result, _trunc, "Truncate toward zero")
    scalar("sqrt", Arity.exactly(1), double_type, _sqrt, "Square root")
    scalar("power", Arity.exactly(2), double_type, _power, "Exponentiation")
    scalar("exp", Arity.exactly(1), double_type, _exp, "e raised to a power")
    scalar("ln", Arity.exactly(1), double_type, _ln, "Natural logarithm")
    scalar("log", Arity.between(1, 2), double_type, _log, "Base-10 or explicit-base log")
    scalar("mod", Arity.exactly(2), numeric_result, _mod, "Remainder")
    scalar(
        "greatest",
        Arity.at_least(1),
        numeric_result,
        _greatest,
        "Largest non-null argument",
        propagates_null=False,
    )
    scalar(
        "least",
        Arity.at_least(1),
        numeric_result,
        _least,
        "Smallest non-null argument",
        propagates_null=False,
    )
    registry.register_scalar(
        ScalarFunctionDef(
            name="power",
            arity=Arity.exactly(2),
            resolve_type=double_type,
            evaluate=_power,
            description="Exponentiation",
        ),
        "pow",
    )
