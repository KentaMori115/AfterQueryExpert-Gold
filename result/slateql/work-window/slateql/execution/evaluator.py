"""Compiles typed expressions into row-level closures.

Compilation happens once per operator, not once per row: column references are
resolved to ordinals, function definitions are looked up, and the resulting
closure captures everything it needs.  This is where SQL's three-valued logic
lives, so the rules are spelled out explicitly rather than leaning on Python's
truthiness.
"""

from __future__ import annotations

from typing import Any, Callable, Optional, Sequence

from ..errors import ExecutionError
from ..functions.registry import FunctionRegistry
from ..functions.scalar_string import matches_like
from ..plan import expressions as X
from ..types.schema import Schema
from ..types.values import cast_value
from ..util.ordering import compare_values

__all__ = ["ExpressionEvaluator", "RowFunction", "compile_expression"]

RowFunction = Callable[[Sequence[Any]], Any]

_COMPARATORS: dict[str, Callable[[int], bool]] = {
    "=": lambda order: order == 0,
    "<>": lambda order: order != 0,
    "<": lambda order: order < 0,
    "<=": lambda order: order <= 0,
    ">": lambda order: order > 0,
    ">=": lambda order: order >= 0,
}


class ExpressionEvaluator:
    """Turns :class:`~slateql.plan.expressions.Expr` trees into closures."""

    def __init__(
        self,
        registry: FunctionRegistry,
        *,
        strict_casts: bool = False,
    ) -> None:
        self.registry = registry
        self.strict_casts = strict_casts

    def compile(self, expression: X.Expr, schema: Schema) -> RowFunction:
        """Compile ``expression`` against ``schema``."""

        if isinstance(expression, X.Literal):
            value = expression.value
            return lambda row: value
        if isinstance(expression, X.Column):
            index = schema.index_of(expression.name, expression.qualifier)
            return lambda row: row[index]
        if isinstance(expression, X.UnaryExpr):
            return self._compile_unary(expression, schema)
        if isinstance(expression, X.BinaryExpr):
            return self._compile_binary(expression, schema)
        if isinstance(expression, X.ScalarFunction):
            return self._compile_function(expression, schema)
        if isinstance(expression, X.CastExpr):
            return self._compile_cast(expression, schema)
        if isinstance(expression, X.CaseExpr):
            return self._compile_case(expression, schema)
        if isinstance(expression, X.InList):
            return self._compile_in_list(expression, schema)
        if isinstance(expression, X.IsNull):
            return self._compile_is_null(expression, schema)
        if isinstance(expression, X.LikeMatch):
            return self._compile_like(expression, schema)
        if isinstance(expression, X.AggregateCall):
            raise ExecutionError(
                "aggregate calls must be evaluated by the aggregate operator"
            )
        raise ExecutionError(
            f"cannot evaluate expression node {type(expression).__name__}"
        )

    def compile_all(
        self, expressions: Sequence[X.Expr], schema: Schema
    ) -> list[RowFunction]:
        return [self.compile(expression, schema) for expression in expressions]

    def compile_predicate(
        self, expression: X.Expr, schema: Schema
    ) -> Callable[[Sequence[Any]], bool]:
        """Compile a predicate, collapsing NULL to ``False`` as WHERE does."""

        inner = self.compile(expression, schema)

        def _predicate(row: Sequence[Any]) -> bool:
            return inner(row) is True

        return _predicate

    # -- individual node kinds -------------------------------------------

    def _compile_unary(self, node: X.UnaryExpr, schema: Schema) -> RowFunction:
        operand = self.compile(node.operand, schema)
        if node.op == "NOT":

            def _not(row: Sequence[Any]) -> Optional[bool]:
                value = operand(row)
                if value is None:
                    return None
                return not value

            return _not

        def _negate(row: Sequence[Any]) -> Any:
            value = operand(row)
            return None if value is None else -value

        return _negate

    def _compile_binary(self, node: X.BinaryExpr, schema: Schema) -> RowFunction:
        left = self.compile(node.left, schema)
        right = self.compile(node.right, schema)
        op = node.op

        if op == "AND":

            def _and(row: Sequence[Any]) -> Optional[bool]:
                a = left(row)
                if a is False:
                    return False
                b = right(row)
                if b is False:
                    return False
                if a is None or b is None:
                    return None
                return True

            return _and

        if op == "OR":

            def _or(row: Sequence[Any]) -> Optional[bool]:
                a = left(row)
                if a is True:
                    return True
                b = right(row)
                if b is True:
                    return True
                if a is None or b is None:
                    return None
                return False

            return _or

        if op in _COMPARATORS:
            test = _COMPARATORS[op]

            def _compare(row: Sequence[Any]) -> Optional[bool]:
                a = left(row)
                if a is None:
                    return None
                b = right(row)
                if b is None:
                    return None
                return test(compare_values(a, b))

            return _compare

        return self._compile_arithmetic(op, left, right)

    def _compile_arithmetic(
        self, op: str, left: RowFunction, right: RowFunction
    ) -> RowFunction:
        if op == "||":

            def _concat(row: Sequence[Any]) -> Optional[str]:
                a = left(row)
                b = right(row)
                if a is None or b is None:
                    return None
                return f"{a}{b}"

            return _concat

        if op == "+":
            operation = lambda a, b: a + b  # noqa: E731
        elif op == "-":
            operation = lambda a, b: a - b  # noqa: E731
        elif op == "*":
            operation = lambda a, b: a * b  # noqa: E731
        elif op == "/":
            operation = _divide
        elif op == "%":
            operation = _modulo
        else:  # pragma: no cover - guarded by the binder
            raise ExecutionError(f"unsupported arithmetic operator {op!r}")

        def _arith(row: Sequence[Any]) -> Any:
            a = left(row)
            if a is None:
                return None
            b = right(row)
            if b is None:
                return None
            return operation(a, b)

        return _arith

    def _compile_function(self, node: X.ScalarFunction, schema: Schema) -> RowFunction:
        definition = self.registry.scalar(node.name)
        args = self.compile_all(node.args, schema)

        def _call(row: Sequence[Any]) -> Any:
            return definition.call([arg(row) for arg in args])

        return _call

    def _compile_cast(self, node: X.CastExpr, schema: Schema) -> RowFunction:
        operand = self.compile(node.operand, schema)
        target = node.dtype
        strict = self.strict_casts

        def _cast(row: Sequence[Any]) -> Any:
            return cast_value(operand(row), target, strict=strict)

        return _cast

    def _compile_case(self, node: X.CaseExpr, schema: Schema) -> RowFunction:
        branches = [
            (self.compile(branch.condition, schema), self.compile(branch.result, schema))
            for branch in node.branches
        ]
        default = (
            self.compile(node.default, schema) if node.default is not None else None
        )

        def _case(row: Sequence[Any]) -> Any:
            for condition, result in branches:
                if condition(row) is True:
                    return result(row)
            return default(row) if default is not None else None

        return _case

    def _compile_in_list(self, node: X.InList, schema: Schema) -> RowFunction:
        operand = self.compile(node.operand, schema)
        items = self.compile_all(node.items, schema)
        negated = node.negated

        def _in(row: Sequence[Any]) -> Optional[bool]:
            value = operand(row)
            if value is None:
                return None
            saw_null = False
            for item in items:
                candidate = item(row)
                if candidate is None:
                    saw_null = True
                    continue
                if compare_values(value, candidate) == 0:
                    return not negated
            if saw_null:
                return None
            return negated

        return _in

    def _compile_is_null(self, node: X.IsNull, schema: Schema) -> RowFunction:
        operand = self.compile(node.operand, schema)
        negated = node.negated

        def _is_null(row: Sequence[Any]) -> bool:
            return (operand(row) is not None) if negated else (operand(row) is None)

        return _is_null

    def _compile_like(self, node: X.LikeMatch, schema: Schema) -> RowFunction:
        operand = self.compile(node.operand, schema)
        pattern = self.compile(node.pattern, schema)
        escape = self.compile(node.escape, schema) if node.escape is not None else None
        negated = node.negated

        def _like(row: Sequence[Any]) -> Optional[bool]:
            text = operand(row)
            if text is None:
                return None
            template = pattern(row)
            if template is None:
                return None
            escape_char: Optional[str] = None
            if escape is not None:
                raw = escape(row)
                if raw is None:
                    return None
                escape_char = str(raw)
                if len(escape_char) != 1:
                    raise ExecutionError(
                        "ESCAPE requires a single-character string"
                    )
            matched = matches_like(str(text), str(template), escape_char)
            return (not matched) if negated else matched

        return _like


def _divide(left: Any, right: Any) -> Any:
    if right == 0:
        raise ExecutionError("division by zero")
    return left / right


def _modulo(left: Any, right: Any) -> Any:
    if right == 0:
        raise ExecutionError("division by zero")
    result = left - right * int(left / right)
    if isinstance(left, int) and isinstance(right, int):
        return int(result)
    return result


def compile_expression(
    expression: X.Expr,
    schema: Schema,
    registry: FunctionRegistry,
    *,
    strict_casts: bool = False,
) -> RowFunction:
    """Compile one expression without constructing an evaluator by hand."""

    return ExpressionEvaluator(registry, strict_casts=strict_casts).compile(
        expression, schema
    )
