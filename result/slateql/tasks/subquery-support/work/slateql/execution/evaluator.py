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
from .context import ExecutionContext
from .keys import row_key

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
        context: Optional[ExecutionContext] = None,
    ) -> None:
        self.registry = registry
        self.strict_casts = strict_casts
        #: The statement's context, needed to run subqueries and to read the
        #: values a correlated subquery borrows from its enclosing row.
        self.context = context

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
        if isinstance(expression, X.OuterRef):
            return self._compile_outer_ref(expression)
        if isinstance(expression, X.SubqueryExpr):
            return self._compile_subquery(expression, schema)
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


    # -- subqueries ------------------------------------------------------

    def _require_context(self, what: str) -> ExecutionContext:
        if self.context is None:
            raise ExecutionError(
                f"{what} needs an execution context to run",
                hint="construct the evaluator with context=...",
            )
        return self.context

    def _compile_outer_ref(self, node: X.OuterRef) -> RowFunction:
        context = self._require_context("a correlated subquery")
        values = context.outer
        index = node.index
        if index >= len(values):
            raise ExecutionError(
                f"correlated reference {node.to_sql()} has no value bound"
            )

        def _outer(row: Sequence[Any]) -> Any:
            return values[index]

        return _outer

    def _compile_subquery(self, node: X.SubqueryExpr, schema: Schema) -> RowFunction:
        """Compile a subquery expression into a per-row closure.

        The nested plan is lowered to operators once, here.  Each call
        evaluates the bindings against the enclosing row, runs the operators
        under a context carrying those values, and folds the rows according
        to the expression kind.  Results are memoised per distinct binding
        tuple, so an uncorrelated subquery (no bindings) runs exactly once
        per statement however many rows the enclosing operator sees.
        """

        from .pipeline import stream_rows
        from .planner import PhysicalPlanner

        context = self._require_context("a subquery")
        operator = PhysicalPlanner(context.catalog).build(node.plan)
        bindings = self.compile_all(node.bindings, schema)
        cache: dict[tuple, Any] = {}

        def rows_for(row: Sequence[Any]) -> tuple[tuple, Any]:
            values = tuple(binding(row) for binding in bindings)
            return row_key(values), values

        if isinstance(node, X.ScalarSubquery):

            def _scalar(row: Sequence[Any]) -> Any:
                key, values = rows_for(row)
                if key in cache:
                    return cache[key]
                result = None
                seen = 0
                for inner in stream_rows(operator, context.with_outer(values)):
                    seen += 1
                    if seen > 1:
                        raise ExecutionError(
                            "scalar subquery produced more than one row",
                            hint="add LIMIT 1 or an aggregate to the subquery",
                        )
                    result = inner[0]
                cache[key] = result
                return result

            return _scalar

        if isinstance(node, X.ExistsSubquery):

            def _exists(row: Sequence[Any]) -> bool:
                key, values = rows_for(row)
                if key in cache:
                    return cache[key]
                found = False
                for _ in stream_rows(operator, context.with_outer(values)):
                    found = True
                    break
                cache[key] = found
                return found

            return _exists

        if isinstance(node, X.InSubquery):
            operand = self.compile(node.operand, schema)
            negated = node.negated

            def _members(row: Sequence[Any]) -> tuple[list[Any], bool]:
                key, values = rows_for(row)
                if key in cache:
                    return cache[key]
                members: list[Any] = []
                saw_null = False
                for inner in stream_rows(operator, context.with_outer(values)):
                    value = inner[0]
                    if value is None:
                        saw_null = True
                    else:
                        members.append(value)
                cache[key] = (members, saw_null)
                return cache[key]

            def _in(row: Sequence[Any]) -> Optional[bool]:
                members, saw_null = _members(row)
                if not members and not saw_null:
                    # Nothing to match against: FALSE, even for a NULL
                    # operand, which is where a subquery differs from the
                    # never-empty literal list.
                    return negated
                value = operand(row)
                if value is None:
                    return None
                for candidate in members:
                    if compare_values(value, candidate) == 0:
                        return not negated
                if saw_null:
                    return None
                return negated

            return _in

        raise ExecutionError(  # pragma: no cover - every kind handled above
            f"cannot evaluate subquery node {type(node).__name__}"
        )


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
    context: Optional[ExecutionContext] = None,
) -> RowFunction:
    """Compile one expression without constructing an evaluator by hand."""

    return ExpressionEvaluator(
        registry, strict_casts=strict_casts, context=context
    ).compile(expression, schema)
