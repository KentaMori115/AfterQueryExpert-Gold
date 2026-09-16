"""Scalar function registry and the built-in function library.

A scalar function maps one row's argument values to a single value. Most of
them never want to think about nulls, so the registry handles null propagation
centrally: a function declared with ``propagates_null=True`` (the default) is
simply not called when any argument is null, and the result is null.

The handful of functions whose entire purpose is null handling — ``coalesce``,
``ifnull``, ``nullif`` — opt out and receive the raw values.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence

from ..errors import FunctionNotFoundError, TypeMismatchError
from ..types.casting import cast_value
from ..types.dtypes import DataType, common_type, is_numeric
from ..types.value import is_null
from ..utils.timeparse import date_part as extract_date_part

__all__ = ["ScalarFunction", "FunctionRegistry", "default_registry", "like_to_regex"]

ReturnTypeRule = Callable[[Sequence[DataType]], DataType]


@dataclass(frozen=True)
class ScalarFunction:
    """A named, arity-checked scalar function.

    Attributes:
        name: The lowercase name used in SQL.
        implementation: Callable receiving the evaluated argument values.
        return_type: Either a fixed :class:`DataType` or a callable computing
            the result type from the argument types.
        min_args: Smallest accepted argument count.
        max_args: Largest accepted argument count, or ``None`` for variadic.
        propagates_null: When true the implementation is skipped and the result
            is null if any argument is null.
        doc: One-line description shown by the CLI.
    """

    name: str
    implementation: Callable[..., Any]
    return_type: DataType | ReturnTypeRule
    min_args: int = 1
    max_args: Optional[int] = 1
    propagates_null: bool = True
    doc: str = ""

    def accepts(self, count: int) -> bool:
        """True when ``count`` arguments satisfy this function's arity."""
        if count < self.min_args:
            return False
        return self.max_args is None or count <= self.max_args

    def arity_text(self) -> str:
        """Describe the accepted argument count for error messages."""
        if self.max_args is None:
            return f"at least {self.min_args}"
        if self.max_args == self.min_args:
            return str(self.min_args)
        return f"{self.min_args} to {self.max_args}"

    def resolve_type(self, arg_types: Sequence[DataType]) -> DataType:
        """Compute the result type for the given argument types.

        Raises:
            TypeMismatchError: If the argument count is wrong.
        """
        if not self.accepts(len(arg_types)):
            raise TypeMismatchError(
                f"{self.name}() takes {self.arity_text()} arguments, "
                f"got {len(arg_types)}",
                operator=self.name,
            )
        if callable(self.return_type):
            return self.return_type(list(arg_types))
        return self.return_type

    def call(self, values: Sequence[Any]) -> Any:
        """Invoke the implementation, applying the null propagation rule."""
        if self.propagates_null and any(is_null(value) for value in values):
            return None
        return self.implementation(*values)


class FunctionRegistry:
    """A mutable, case-insensitive map of scalar function names."""

    def __init__(self, functions: Iterable[ScalarFunction] = ()) -> None:
        self._functions: Dict[str, ScalarFunction] = {}
        for function in functions:
            self.register(function)

    def register(self, function: ScalarFunction, replace: bool = False) -> "FunctionRegistry":
        """Add a function, optionally replacing an existing name.

        Raises:
            ValueError: If the name is taken and ``replace`` is false.
        """
        key = function.name.lower()
        if key in self._functions and not replace:
            raise ValueError(f"function {function.name!r} is already registered")
        self._functions[key] = function
        return self

    def get(self, name: str) -> ScalarFunction:
        """Look up a function.

        Raises:
            FunctionNotFoundError: If no function has that name.
        """
        try:
            return self._functions[name.lower()]
        except KeyError:
            raise FunctionNotFoundError(name, self.names()) from None

    def has(self, name: str) -> bool:
        """True when a function with this name is registered."""
        return name.lower() in self._functions

    def names(self) -> List[str]:
        """Registered names in alphabetical order."""
        return sorted(self._functions)

    def describe(self) -> List[str]:
        """Return ``name -- doc`` lines for every registered function."""
        return [
            f"{name} -- {self._functions[name].doc}" if self._functions[name].doc else name
            for name in self.names()
        ]

    def copy(self) -> "FunctionRegistry":
        """Return an independent copy that can be extended safely."""
        clone = FunctionRegistry()
        clone._functions = dict(self._functions)
        return clone

    def __len__(self) -> int:
        return len(self._functions)

    def __contains__(self, name: object) -> bool:
        return isinstance(name, str) and self.has(name)


# ----------------------------------------------------------------------
# Return type rules
# ----------------------------------------------------------------------
def _same_as_first(arg_types: Sequence[DataType]) -> DataType:
    return arg_types[0] if arg_types else DataType.NULL


def _numeric_result(arg_types: Sequence[DataType]) -> DataType:
    """Widen numeric arguments; anything non-numeric is an error."""
    for dtype in arg_types:
        if dtype != DataType.NULL and not is_numeric(dtype):
            raise TypeMismatchError(f"expected a numeric argument, got {dtype}")
    return common_type(arg_types, context="numeric function")


def _unify_all(arg_types: Sequence[DataType]) -> DataType:
    return common_type(arg_types, context="function arguments")


def _fixed(dtype: DataType) -> ReturnTypeRule:
    def rule(_: Sequence[DataType]) -> DataType:
        return dtype

    return rule


# ----------------------------------------------------------------------
# Implementations
# ----------------------------------------------------------------------
def like_to_regex(pattern: str) -> str:
    """Translate a SQL ``LIKE`` pattern into a regular expression.

    ``%`` matches any run of characters, ``_`` matches exactly one, and a
    backslash escapes either wildcard. Every other character is quoted so that
    regex metacharacters in the pattern are treated literally.
    """
    import re

    out: List[str] = ["^"]
    index = 0
    while index < len(pattern):
        char = pattern[index]
        if char == "\\" and index + 1 < len(pattern):
            out.append(re.escape(pattern[index + 1]))
            index += 2
            continue
        if char == "%":
            out.append(".*")
        elif char == "_":
            out.append(".")
        else:
            out.append(re.escape(char))
        index += 1
    out.append("$")
    return "".join(out)


def _substr(text: str, start: int, length: Optional[int] = None) -> str:
    """One-based substring, matching SQL rather than Python slicing."""
    begin = max(int(start), 1) - 1
    if length is None:
        return text[begin:]
    return text[begin : begin + max(int(length), 0)]


def _round(value: float, digits: int = 0) -> float:
    """Round half away from zero, which is what SQL engines do."""
    factor = 10 ** int(digits)
    scaled = float(value) * factor
    shifted = math.floor(abs(scaled) + 0.5) * (1 if scaled >= 0 else -1)
    result = shifted / factor
    return result if digits > 0 else float(result)


def _coalesce(*values: Any) -> Any:
    for value in values:
        if not is_null(value):
            return value
    return None


def _nullif(left: Any, right: Any) -> Any:
    if is_null(left):
        return None
    if not is_null(right) and left == right:
        return None
    return left


def _if(condition: Any, when_true: Any, when_false: Any) -> Any:
    from ..types.value import coerce_bool

    return when_true if coerce_bool(condition) is True else when_false


def _safe_divide(left: float, right: float) -> Optional[float]:
    if float(right) == 0.0:
        return None
    return float(left) / float(right)


def _log(value: float, base: float = math.e) -> Optional[float]:
    if value <= 0 or base <= 0 or base == 1:
        return None
    return math.log(value, base)


def _sqrt(value: float) -> Optional[float]:
    return None if value < 0 else math.sqrt(value)


def default_registry() -> FunctionRegistry:
    """Build a registry containing every built-in scalar function."""
    registry = FunctionRegistry()

    def add(
        name: str,
        implementation: Callable[..., Any],
        return_type: DataType | ReturnTypeRule,
        min_args: int = 1,
        max_args: Optional[int] = 1,
        propagates_null: bool = True,
        doc: str = "",
    ) -> None:
        registry.register(
            ScalarFunction(
                name=name,
                implementation=implementation,
                return_type=return_type,
                min_args=min_args,
                max_args=max_args,
                propagates_null=propagates_null,
                doc=doc,
            )
        )

    # -- string ------------------------------------------------------
    add("upper", lambda text: str(text).upper(), DataType.STRING, doc="Uppercase text")
    add("lower", lambda text: str(text).lower(), DataType.STRING, doc="Lowercase text")
    add("length", lambda text: len(str(text)), DataType.INT64, doc="Character count")
    add("trim", lambda text: str(text).strip(), DataType.STRING, doc="Strip both ends")
    add("ltrim", lambda text: str(text).lstrip(), DataType.STRING, doc="Strip the left end")
    add("rtrim", lambda text: str(text).rstrip(), DataType.STRING, doc="Strip the right end")
    add("reverse", lambda text: str(text)[::-1], DataType.STRING, doc="Reverse text")
    add(
        "substr",
        _substr,
        DataType.STRING,
        min_args=2,
        max_args=3,
        doc="One-based substring",
    )
    add(
        "replace",
        lambda text, old, new: str(text).replace(str(old), str(new)),
        DataType.STRING,
        min_args=3,
        max_args=3,
        doc="Replace every occurrence",
    )
    add(
        "concat",
        lambda *parts: "".join("" if is_null(part) else _as_text(part) for part in parts),
        DataType.STRING,
        min_args=1,
        max_args=None,
        propagates_null=False,
        doc="Join arguments, treating nulls as empty",
    )
    add(
        "starts_with",
        lambda text, prefix: str(text).startswith(str(prefix)),
        DataType.BOOL,
        min_args=2,
        max_args=2,
        doc="Prefix test",
    )
    add(
        "ends_with",
        lambda text, suffix: str(text).endswith(str(suffix)),
        DataType.BOOL,
        min_args=2,
        max_args=2,
        doc="Suffix test",
    )
    add(
        "contains",
        lambda text, needle: str(needle) in str(text),
        DataType.BOOL,
        min_args=2,
        max_args=2,
        doc="Substring test",
    )
    add(
        "split_part",
        lambda text, sep, index: _split_part(str(text), str(sep), int(index)),
        DataType.STRING,
        min_args=3,
        max_args=3,
        doc="One-based split component",
    )
    add(
        "lpad",
        lambda text, width, fill=" ": str(text).rjust(int(width), str(fill)[:1] or " "),
        DataType.STRING,
        min_args=2,
        max_args=3,
        doc="Left pad to a width",
    )
    add(
        "rpad",
        lambda text, width, fill=" ": str(text).ljust(int(width), str(fill)[:1] or " "),
        DataType.STRING,
        min_args=2,
        max_args=3,
        doc="Right pad to a width",
    )

    # -- numeric -----------------------------------------------------
    add("abs", lambda value: abs(value), _numeric_result, doc="Absolute value")
    add("sign", lambda value: (value > 0) - (value < 0), DataType.INT64, doc="Sign as -1/0/1")
    add(
        "round",
        _round,
        DataType.FLOAT64,
        min_args=1,
        max_args=2,
        doc="Round half away from zero",
    )
    add("floor", lambda value: math.floor(value), DataType.INT64, doc="Round towards minus infinity")
    add("ceil", lambda value: math.ceil(value), DataType.INT64, doc="Round towards infinity")
    add("sqrt", _sqrt, DataType.FLOAT64, doc="Square root, null for negatives")
    add(
        "power",
        lambda base, exponent: float(base) ** float(exponent),
        DataType.FLOAT64,
        min_args=2,
        max_args=2,
        doc="Raise to a power",
    )
    add(
        "mod",
        lambda left, right: None if right == 0 else left % right,
        _numeric_result,
        min_args=2,
        max_args=2,
        doc="Remainder, null on zero divisor",
    )
    add(
        "safe_divide",
        _safe_divide,
        DataType.FLOAT64,
        min_args=2,
        max_args=2,
        doc="Division returning null instead of failing on zero",
    )
    add("exp", lambda value: math.exp(value), DataType.FLOAT64, doc="Natural exponential")
    add("ln", lambda value: _log(value), DataType.FLOAT64, doc="Natural logarithm")
    add(
        "log",
        lambda value, base=10.0: _log(value, base),
        DataType.FLOAT64,
        min_args=1,
        max_args=2,
        doc="Logarithm, base 10 by default",
    )
    add(
        "greatest",
        lambda *values: _extreme(values, largest=True),
        _unify_all,
        min_args=1,
        max_args=None,
        propagates_null=False,
        doc="Largest non-null argument",
    )
    add(
        "least",
        lambda *values: _extreme(values, largest=False),
        _unify_all,
        min_args=1,
        max_args=None,
        propagates_null=False,
        doc="Smallest non-null argument",
    )

    # -- null handling ------------------------------------------------
    add(
        "coalesce",
        _coalesce,
        _unify_all,
        min_args=1,
        max_args=None,
        propagates_null=False,
        doc="First non-null argument",
    )
    add(
        "ifnull",
        lambda value, fallback: fallback if is_null(value) else value,
        _unify_all,
        min_args=2,
        max_args=2,
        propagates_null=False,
        doc="Replace null with a fallback",
    )
    add(
        "nullif",
        _nullif,
        _same_as_first,
        min_args=2,
        max_args=2,
        propagates_null=False,
        doc="Null when both arguments are equal",
    )
    add(
        "if",
        _if,
        lambda types: common_type(types[1:], context="if"),
        min_args=3,
        max_args=3,
        propagates_null=False,
        doc="Branch on a condition",
    )

    # -- temporal ----------------------------------------------------
    add(
        "date_part",
        lambda part, value: extract_date_part(str(part), value),
        DataType.INT64,
        min_args=2,
        max_args=2,
        doc="Extract a named component from a timestamp",
    )
    for part in ("year", "month", "day", "hour", "minute", "second"):
        add(
            part,
            _date_part_shortcut(part),
            DataType.INT64,
            doc=f"Extract the {part} from a timestamp",
        )

    # -- conversion ---------------------------------------------------
    add(
        "to_string",
        lambda value: cast_value(value, DataType.STRING),
        DataType.STRING,
        doc="Cast to text",
    )
    add(
        "to_int",
        lambda value: cast_value(value, DataType.INT64),
        DataType.INT64,
        doc="Cast to an integer",
    )
    add(
        "to_float",
        lambda value: cast_value(value, DataType.FLOAT64),
        DataType.FLOAT64,
        doc="Cast to a float",
    )
    add(
        "to_timestamp",
        lambda value: cast_value(value, DataType.TIMESTAMP),
        DataType.TIMESTAMP,
        doc="Cast to a timestamp",
    )
    return registry


def _as_text(value: Any) -> str:
    """Render a value as text using cast rules, for ``concat``."""
    return cast_value(value, DataType.STRING)


def _split_part(text: str, separator: str, index: int) -> str:
    """Return the one-based ``index`` component of a split, or empty text."""
    if not separator:
        return text if index == 1 else ""
    parts = text.split(separator)
    if index < 1 or index > len(parts):
        return ""
    return parts[index - 1]


def _extreme(values: Sequence[Any], largest: bool) -> Any:
    """Return the largest or smallest non-null value."""
    from ..types.value import sort_key

    present = [value for value in values if not is_null(value)]
    if not present:
        return None
    return (max if largest else min)(present, key=sort_key)


def _date_part_shortcut(part: str) -> Callable[[Any], int]:
    """Build a one-argument wrapper around :func:`date_part`."""

    def implementation(value: Any) -> int:
        return extract_date_part(part, value)

    return implementation
