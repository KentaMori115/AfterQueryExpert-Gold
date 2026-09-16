"""Boolean and comparison simplification.

These rewrites shrink predicates so that later rules -- especially predicate
pushdown -- see fewer, simpler conjuncts.  Every rewrite here preserves SQL's
three-valued logic; in particular ``x AND NULL`` is *not* ``NULL`` when ``x``
is FALSE, so ``AND`` with a NULL literal is only simplified when the other side
is a known constant.
"""

from __future__ import annotations

from ...plan import expressions as X
from ...plan.logical import LogicalPlan
from ...plan.visitor import map_expressions, transform_up
from ...types.datatypes import BOOLEAN
from ..rule import Rule, RuleContext

__all__ = ["SimplifyExpressions", "simplify"]


class SimplifyExpressions(Rule):
    """Applies algebraic identities to boolean expressions."""

    name = "simplify-expressions"

    def apply(self, plan: LogicalPlan, context: RuleContext) -> LogicalPlan:
        return transform_up(plan, lambda node: map_expressions(node, simplify))


def simplify(expression: X.Expr) -> X.Expr:
    """Simplify ``expression`` bottom-up."""

    return expression.transform(_simplify_node)


def _simplify_node(node: X.Expr) -> X.Expr:
    if isinstance(node, X.UnaryExpr) and node.op == "NOT":
        return _simplify_not(node)
    if isinstance(node, X.BinaryExpr):
        if node.op == "AND":
            return _simplify_and(node)
        if node.op == "OR":
            return _simplify_or(node)
    if isinstance(node, X.CaseExpr):
        return _simplify_case(node)
    if isinstance(node, X.InList) and len(node.items) == 1:
        item = node.items[0]
        op = "<>" if node.negated else "="
        return X.BinaryExpr(
            op=op, left=node.operand, right=item, dtype=node.dtype
        )
    return node


def _is_true(node: X.Expr) -> bool:
    return isinstance(node, X.Literal) and node.value is True


def _is_false(node: X.Expr) -> bool:
    return isinstance(node, X.Literal) and node.value is False


def _is_null_literal(node: X.Expr) -> bool:
    return isinstance(node, X.Literal) and node.value is None


def _simplify_not(node: X.UnaryExpr) -> X.Expr:
    operand = node.operand
    if isinstance(operand, X.UnaryExpr) and operand.op == "NOT":
        return operand.operand
    if _is_true(operand):
        return X.FALSE
    if _is_false(operand):
        return X.TRUE
    if isinstance(operand, X.IsNull):
        return X.IsNull(
            operand=operand.operand,
            dtype=operand.dtype,
            negated=not operand.negated,
        )
    if isinstance(operand, X.BinaryExpr) and operand.op in _NEGATED_COMPARISON:
        return X.BinaryExpr(
            op=_NEGATED_COMPARISON[operand.op],
            left=operand.left,
            right=operand.right,
            dtype=operand.dtype,
        )
    return node


_NEGATED_COMPARISON = {
    "=": "<>",
    "<>": "=",
    "<": ">=",
    "<=": ">",
    ">": "<=",
    ">=": "<",
}


def _simplify_and(node: X.BinaryExpr) -> X.Expr:
    left, right = node.left, node.right
    if _is_false(left) or _is_false(right):
        return X.FALSE
    if _is_true(left):
        return right
    if _is_true(right):
        return left
    if left == right:
        return left
    return node


def _simplify_or(node: X.BinaryExpr) -> X.Expr:
    left, right = node.left, node.right
    if _is_true(left) or _is_true(right):
        return X.TRUE
    if _is_false(left):
        return right
    if _is_false(right):
        return left
    if left == right:
        return left
    return node


def _simplify_case(node: X.CaseExpr) -> X.Expr:
    """Drop branches whose condition is a constant FALSE and stop at the first
    constant TRUE branch, since later branches are unreachable."""

    branches: list[X.CaseBranch] = []
    default = node.default
    for branch in node.branches:
        if _is_false(branch.condition) or _is_null_literal(branch.condition):
            continue
        if _is_true(branch.condition):
            if not branches:
                return branch.result
            default = branch.result
            break
        branches.append(branch)
    if not branches:
        if default is not None:
            return default
        return X.Literal(value=None, dtype=node.dtype)
    if len(branches) == len(node.branches) and default is node.default:
        return node
    return X.CaseExpr(branches=tuple(branches), dtype=node.dtype, default=default)


def boolean_literal(value: bool) -> X.Literal:
    """Build a non-nullable boolean literal."""

    return X.Literal(value=value, dtype=BOOLEAN.as_nullable(False))
