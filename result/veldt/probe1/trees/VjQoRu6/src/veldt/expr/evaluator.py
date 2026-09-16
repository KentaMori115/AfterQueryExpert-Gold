"""Expression evaluation over record batches.

The evaluator turns an :class:`~veldt.expr.ast.Expression` plus a
:class:`~veldt.core.batch.RecordBatch` into a single output
:class:`~veldt.core.column.Column`. It works one node at a time, materialising
an intermediate column per node. That is more allocation than a fused loop, but
it keeps every operator's semantics in one readable place.

Null handling follows SQL:

* arithmetic and comparison propagate nulls,
* ``AND``/``OR`` use three-valued logic, so ``false AND null`` is ``false``
  while ``true AND null`` is ``null``,
* a ``WHERE`` predicate that evaluates to null does not select the row.
"""

from __future__ import annotations

import re
from typing import Any, Callable, Dict, List, Optional, Sequence

from ..core.batch import RecordBatch
from ..core.column import Column
from ..errors import ExecutionError
from ..types.casting import cast_value
from ..types.dtypes import DataType
from ..types.schema import Schema
from ..types.value import coerce_bool, compare_values, is_null, values_equal
from ..utils.hashing import value_key
from .aggregates import AggregateRegistry, default_aggregate_registry
from .ast import (
    Alias,
    AggregateCall,
    Between,
    BinaryOp,
    CaseWhen,
    Cast,
    ColumnRef,
    Expression,
    FunctionCall,
    InList,
    IsNull,
    Literal,
    UnaryOp,
)
from .functions import FunctionRegistry, default_registry, like_to_regex
from .resolver import ExpressionResolver, find_column

__all__ = ["Evaluator", "evaluate", "evaluate_predicate"]

# Compiled LIKE patterns are reused across batches; the cache is bounded so a
# query generating many distinct patterns cannot grow it without limit.
_PATTERN_CACHE: Dict[str, "re.Pattern[str]"] = {}
_PATTERN_CACHE_LIMIT = 256


class Evaluator:
    """Evaluates expressions against batches."""

    def __init__(
        self,
        functions: Optional[FunctionRegistry] = None,
        aggregates: Optional[AggregateRegistry] = None,
    ) -> None:
        self.functions = functions or default_registry()
        self.aggregates = aggregates or default_aggregate_registry()
        self.resolver = ExpressionResolver(self.functions, self.aggregates)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    def evaluate(self, expression: Expression, batch: RecordBatch) -> Column:
        """Evaluate ``expression`` over every row of ``batch``."""
        column = self._evaluate(expression, batch)
        from .ast import output_name

        name = output_name(expression)
        return column if column.name == name else column.rename(name)

    def evaluate_many(
        self, expressions: Sequence[Expression], batch: RecordBatch
    ) -> List[Column]:
        """Evaluate several expressions over the same batch."""
        return [self.evaluate(expression, batch) for expression in expressions]

    def evaluate_predicate(self, expression: Expression, batch: RecordBatch) -> List[Optional[bool]]:
        """Evaluate a predicate, returning a three-valued mask.

        Entries are ``True``, ``False`` or ``None``; only ``True`` selects a row.
        """
        column = self._evaluate(expression, batch)
        return [coerce_bool(value) for value in column.values]

    def evaluate_scalar(self, expression: Expression, row: Dict[str, Any], schema: Schema) -> Any:
        """Evaluate an expression against a single row dictionary."""
        columns = [Column(field.name, field.dtype, [row.get(field.name)]) for field in schema]
        batch = RecordBatch(schema, columns)
        return self._evaluate(expression, batch)[0]

    def evaluate_constant(self, expression: Expression) -> Any:
        """Evaluate an expression that references no columns.

        Raises:
            ExecutionError: If the expression turns out to need input columns.
        """
        empty = RecordBatch(Schema(()), [])
        try:
            column = self._evaluate_with_rows(expression, empty, 1)
        except Exception as error:  # noqa: BLE001 - re-raised with context
            raise ExecutionError(f"cannot fold constant {expression.to_sql()}: {error}") from error
        return column[0]

    # ------------------------------------------------------------------
    # Dispatch
    # ------------------------------------------------------------------
    def _evaluate(self, expression: Expression, batch: RecordBatch) -> Column:
        return self._evaluate_with_rows(expression, batch, batch.num_rows)

    def _evaluate_with_rows(
        self, expression: Expression, batch: RecordBatch, num_rows: int
    ) -> Column:
        if isinstance(expression, Literal):
            return Column("literal", expression.dtype, [expression.value] * num_rows)
        if isinstance(expression, ColumnRef):
            return batch.column(find_column(batch.schema, expression))
        if isinstance(expression, Alias):
            return self._evaluate_with_rows(expression.child, batch, num_rows).rename(
                expression.name
            )
        if isinstance(expression, Cast):
            child = self._evaluate_with_rows(expression.child, batch, num_rows)
            return Column(
                "cast",
                expression.target,
                [cast_value(value, expression.target) for value in child.values],
            )
        if isinstance(expression, UnaryOp):
            return self._evaluate_unary(expression, batch, num_rows)
        if isinstance(expression, BinaryOp):
            return self._evaluate_binary(expression, batch, num_rows)
        if isinstance(expression, IsNull):
            child = self._evaluate_with_rows(expression.child, batch, num_rows)
            values = [is_null(value) != expression.negated for value in child.values]
            return Column("is_null", DataType.BOOL, values)
        if isinstance(expression, InList):
            return self._evaluate_in_list(expression, batch, num_rows)
        if isinstance(expression, Between):
            return self._evaluate_with_rows(expression.expand(), batch, num_rows)
        if isinstance(expression, CaseWhen):
            return self._evaluate_case(expression, batch, num_rows)
        if isinstance(expression, FunctionCall):
            return self._evaluate_function(expression, batch, num_rows)
        if isinstance(expression, AggregateCall):
            raise ExecutionError(
                f"aggregate {expression.name}() cannot be evaluated row by row; "
                "it must appear under an aggregation"
            )
        raise ExecutionError(f"cannot evaluate {type(expression).__name__}")

    # ------------------------------------------------------------------
    # Node implementations
    # ------------------------------------------------------------------
    def _evaluate_unary(self, expression: UnaryOp, batch: RecordBatch, num_rows: int) -> Column:
        operand = self._evaluate_with_rows(expression.operand, batch, num_rows)
        if expression.operator == "not":
            values: List[Any] = []
            for value in operand.values:
                truth = coerce_bool(value)
                values.append(None if truth is None else not truth)
            return Column("not", DataType.BOOL, values)
        if expression.operator == "+":
            return operand
        negated = [None if is_null(value) else -value for value in operand.values]
        return Column("neg", operand.dtype, negated)

    def _evaluate_binary(self, expression: BinaryOp, batch: RecordBatch, num_rows: int) -> Column:
        operator = expression.operator
        if operator in ("and", "or"):
            return self._evaluate_logical(expression, batch, num_rows)
        left = self._evaluate_with_rows(expression.left, batch, num_rows)
        right = self._evaluate_with_rows(expression.right, batch, num_rows)
        if operator in ("like", "not like"):
            return self._evaluate_like(left, right, negated=operator == "not like")
        if expression.is_comparison:
            handler = _COMPARISONS[operator]
            values = [handler(a, b) for a, b in zip(left.values, right.values)]
            return Column("compare", DataType.BOOL, values)
        if operator == "||":
            values = [
                None
                if is_null(a) or is_null(b)
                else cast_value(a, DataType.STRING) + cast_value(b, DataType.STRING)
                for a, b in zip(left.values, right.values)
            ]
            return Column("concat", DataType.STRING, values)
        handler = _ARITHMETIC[operator]
        dtype = DataType.FLOAT64 if operator == "/" else _widen(left.dtype, right.dtype)
        values = [
            None if is_null(a) or is_null(b) else handler(a, b)
            for a, b in zip(left.values, right.values)
        ]
        return Column("arith", dtype, values)

    def _evaluate_logical(
        self, expression: BinaryOp, batch: RecordBatch, num_rows: int
    ) -> Column:
        """Evaluate ``AND``/``OR`` with SQL three-valued logic."""
        left = self._evaluate_with_rows(expression.left, batch, num_rows)
        right = self._evaluate_with_rows(expression.right, batch, num_rows)
        values: List[Optional[bool]] = []
        conjunction = expression.operator == "and"
        for raw_left, raw_right in zip(left.values, right.values):
            a = coerce_bool(raw_left)
            b = coerce_bool(raw_right)
            if conjunction:
                if a is False or b is False:
                    values.append(False)
                elif a is None or b is None:
                    values.append(None)
                else:
                    values.append(True)
            else:
                if a is True or b is True:
                    values.append(True)
                elif a is None or b is None:
                    values.append(None)
                else:
                    values.append(False)
        return Column(expression.operator, DataType.BOOL, values)

    def _evaluate_like(self, left: Column, right: Column, negated: bool) -> Column:
        values: List[Optional[bool]] = []
        for text, pattern in zip(left.values, right.values):
            if is_null(text) or is_null(pattern):
                values.append(None)
                continue
            matched = _compiled_pattern(str(pattern)).match(str(text)) is not None
            values.append(not matched if negated else matched)
        return Column("like", DataType.BOOL, values)

    def _evaluate_in_list(self, expression: InList, batch: RecordBatch, num_rows: int) -> Column:
        child = self._evaluate_with_rows(expression.child, batch, num_rows)
        option_columns = [
            self._evaluate_with_rows(option, batch, num_rows) for option in expression.options
        ]
        values: List[Optional[bool]] = []
        for index, value in enumerate(child.values):
            if is_null(value):
                values.append(None)
                continue
            found = False
            saw_null = False
            for option in option_columns:
                candidate = option[index]
                if is_null(candidate):
                    saw_null = True
                    continue
                if values_equal(value, candidate) is True:
                    found = True
                    break
            if found:
                values.append(not expression.negated)
            elif saw_null:
                # SQL: a non-match against a list containing NULL is unknown.
                values.append(None)
            else:
                values.append(expression.negated)
        return Column("in", DataType.BOOL, values)

    def _evaluate_case(self, expression: CaseWhen, batch: RecordBatch, num_rows: int) -> Column:
        conditions = [
            self._evaluate_predicate_values(condition, batch, num_rows)
            for condition, _ in expression.branches
        ]
        results = [
            self._evaluate_with_rows(result, batch, num_rows)
            for _, result in expression.branches
        ]
        otherwise = (
            self._evaluate_with_rows(expression.otherwise, batch, num_rows)
            if expression.otherwise is not None
            else None
        )
        values: List[Any] = []
        for index in range(num_rows):
            chosen: Any = None
            for branch, mask in enumerate(conditions):
                if mask[index] is True:
                    chosen = results[branch][index]
                    break
            else:
                chosen = otherwise[index] if otherwise is not None else None
            values.append(chosen)
        dtype = _widen_all([column.dtype for column in results] + ([otherwise.dtype] if otherwise else []))
        return Column("case", dtype, values)

    def _evaluate_function(
        self, expression: FunctionCall, batch: RecordBatch, num_rows: int
    ) -> Column:
        function = self.functions.get(expression.name)
        columns = [
            self._evaluate_with_rows(argument, batch, num_rows) for argument in expression.args
        ]
        dtype = function.resolve_type([column.dtype for column in columns])
        values: List[Any] = []
        for index in range(num_rows):
            arguments = [column[index] for column in columns]
            try:
                values.append(function.call(arguments))
            except ExecutionError:
                raise
            except Exception as error:  # noqa: BLE001 - surfaced with context
                raise ExecutionError(
                    f"{expression.name}() failed on row {index}: {error}"
                ) from error
        return Column(expression.name, dtype, values)

    def _evaluate_predicate_values(
        self, expression: Expression, batch: RecordBatch, num_rows: int
    ) -> List[Optional[bool]]:
        column = self._evaluate_with_rows(expression, batch, num_rows)
        return [coerce_bool(value) for value in column.values]


# ----------------------------------------------------------------------
# Operator tables
# ----------------------------------------------------------------------
def _equal(left: Any, right: Any) -> Optional[bool]:
    return values_equal(left, right)


def _not_equal(left: Any, right: Any) -> Optional[bool]:
    result = values_equal(left, right)
    return None if result is None else not result


def _ordering(operator: str) -> Callable[[Any, Any], Optional[bool]]:
    def compare(left: Any, right: Any) -> Optional[bool]:
        order = compare_values(left, right)
        if order is None:
            return None
        if operator == "<":
            return order < 0
        if operator == "<=":
            return order <= 0
        if operator == ">":
            return order > 0
        return order >= 0

    return compare


_COMPARISONS: Dict[str, Callable[[Any, Any], Optional[bool]]] = {
    "=": _equal,
    "!=": _not_equal,
    "<": _ordering("<"),
    "<=": _ordering("<="),
    ">": _ordering(">"),
    ">=": _ordering(">="),
}


def _divide(left: Any, right: Any) -> Optional[float]:
    """Float division that yields null rather than raising on a zero divisor."""
    if float(right) == 0.0:
        return None
    return float(left) / float(right)


def _modulo(left: Any, right: Any) -> Optional[Any]:
    if right == 0:
        return None
    return left % right


_ARITHMETIC: Dict[str, Callable[[Any, Any], Any]] = {
    "+": lambda left, right: left + right,
    "-": lambda left, right: left - right,
    "*": lambda left, right: left * right,
    "/": _divide,
    "%": _modulo,
}


def _widen(left: DataType, right: DataType) -> DataType:
    """Pick the wider of two numeric types for an arithmetic result."""
    if DataType.FLOAT64 in (left, right):
        return DataType.FLOAT64
    if left == DataType.NULL:
        return right
    if right == DataType.NULL:
        return left
    return left


def _widen_all(dtypes: Sequence[DataType]) -> DataType:
    """Fold :func:`_widen` semantics across several branch types."""
    present = [dtype for dtype in dtypes if dtype != DataType.NULL]
    if not present:
        return DataType.NULL
    result = present[0]
    for dtype in present[1:]:
        if dtype != result:
            if dtype in (DataType.INT64, DataType.FLOAT64) and result in (
                DataType.INT64,
                DataType.FLOAT64,
            ):
                result = DataType.FLOAT64
            else:
                return DataType.STRING
    return result


def _compiled_pattern(pattern: str) -> "re.Pattern[str]":
    """Compile and cache a ``LIKE`` pattern."""
    cached = _PATTERN_CACHE.get(pattern)
    if cached is not None:
        return cached
    compiled = re.compile(like_to_regex(pattern), re.DOTALL)
    if len(_PATTERN_CACHE) >= _PATTERN_CACHE_LIMIT:
        _PATTERN_CACHE.clear()
    _PATTERN_CACHE[pattern] = compiled
    return compiled


_DEFAULT_EVALUATOR = Evaluator()


def evaluate(expression: Expression, batch: RecordBatch) -> Column:
    """Evaluate an expression using the default registries."""
    return _DEFAULT_EVALUATOR.evaluate(expression, batch)


def evaluate_predicate(expression: Expression, batch: RecordBatch) -> List[Optional[bool]]:
    """Evaluate a predicate using the default registries."""
    return _DEFAULT_EVALUATOR.evaluate_predicate(expression, batch)


def value_signature(values: Sequence[Any]) -> tuple:
    """Return a stable key for a row of values, used by grouping operators."""
    return tuple(value_key(value) for value in values)
