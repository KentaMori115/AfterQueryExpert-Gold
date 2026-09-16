"""Constant folding.

Any subexpression whose value cannot depend on the row -- literals, arithmetic
over literals, pure functions of constants -- is evaluated once at planning
time and replaced by a literal.  Volatile functions such as ``now()`` are
excluded, and an expression that raises while folding (``1/0``) is left alone
so that the error still surfaces at execution time with the row context.
"""

from __future__ import annotations

from typing import Optional

from ...errors import ExecutionError, SlateQLError
from ...functions.registry import FunctionRegistry, default_registry
from ...plan import expressions as X
from ...plan.logical import LogicalPlan
from ...plan.visitor import map_expressions, transform_up
from ...types.datatypes import NULL, type_from_python
from ...types.schema import Schema
from ..rule import Rule, RuleContext

__all__ = ["ConstantFolding", "fold_expression"]


class ConstantFolding(Rule):
    """Replaces constant subexpressions with literals."""

    name = "constant-folding"

    def __init__(self, registry: Optional[FunctionRegistry] = None) -> None:
        self._registry = registry

    def apply(self, plan: LogicalPlan, context: RuleContext) -> LogicalPlan:
        registry = self._registry or default_registry()

        def _rewrite(node: LogicalPlan) -> LogicalPlan:
            return map_expressions(node, lambda e: fold_expression(e, registry))

        return transform_up(plan, _rewrite)


def fold_expression(
    expression: X.Expr, registry: Optional[FunctionRegistry] = None
) -> X.Expr:
    """Fold every constant subexpression of ``expression``."""

    active = registry or default_registry()

    def _fold(node: X.Expr) -> X.Expr:
        if isinstance(node, X.Literal):
            return node
        if not node.is_constant or node.is_volatile:
            return node
        value = _evaluate(node, active)
        if value is _UNFOLDABLE:
            return node
        if value is None:
            return X.Literal(value=None, dtype=NULL)
        try:
            dtype = type_from_python(value)
        except SlateQLError:  # pragma: no cover - defensive
            return node
        return X.Literal(value=value, dtype=dtype.as_nullable(False))

    return expression.transform(_fold)


class _Unfoldable:
    """Sentinel marking an expression that must stay unevaluated."""

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return "<unfoldable>"


_UNFOLDABLE = _Unfoldable()


def _evaluate(expression: X.Expr, registry: FunctionRegistry):
    from ...execution.evaluator import ExpressionEvaluator

    evaluator = ExpressionEvaluator(registry, strict_casts=False)
    try:
        function = evaluator.compile(expression, Schema.empty())
        return function([])
    except ExecutionError:
        return _UNFOLDABLE
    except SlateQLError:  # pragma: no cover - defensive
        return _UNFOLDABLE
    except (ArithmeticError, TypeError, ValueError):  # pragma: no cover
        return _UNFOLDABLE
