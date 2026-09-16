"""Built-in scalar and aggregate function definitions."""

from .registry import FunctionRegistry, builtin_registry, default_registry
from .scalar_string import like_to_regex, matches_like
from .signature import (
    Accumulator,
    AggregateFunctionDef,
    Arity,
    ScalarFunctionDef,
    fixed_type,
)

__all__ = [
    "FunctionRegistry",
    "builtin_registry",
    "default_registry",
    "like_to_regex",
    "matches_like",
    "Accumulator",
    "AggregateFunctionDef",
    "Arity",
    "ScalarFunctionDef",
    "fixed_type",
]
