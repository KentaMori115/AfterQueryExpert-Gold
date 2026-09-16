"""Expression-level rewrites: constant folding and boolean simplification.

These rewrites are used by the optimizer, but they live next to the AST because
they are purely local: every function here maps an expression to an equivalent
expression without knowing anything about plans, schemas or data.

The conjunction helpers (:func:`split_conjunction` and
:func:`combine_conjunction`) are what predicate pushdown is built on — a filter
is split into independent terms, each term is routed as far down the plan as it
can go, and the leftovers are recombined.
"""

from __future__ import annotations

from typing import Any, List, Optional, Sequence

from ..errors import ExecutionError, VeldtError
from ..types.dtypes import DataType, infer_dtype
from ..types.value import is_null
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
    transform,
    walk,
)

__all__ = [
    "simplify",
    "fold_constants",
    "is_constant",
    "as_constant",
    "split_conjunction",
    "combine_conjunction",
    "split_disjunction",
    "combine_disjunction",
    "TRUE",
    "FALSE",
]

TRUE = Literal(True, DataType.BOOL)
FALSE = Literal(False, DataType.BOOL)
NULL = Literal(None, DataType.NULL)

# Functions whose result depends only on their arguments. Everything in the
# built-in library qualifies, but a user-registered function might not, so the
# folder only trusts this list.
_PURE_FUNCTIONS = frozenset(
    {
        "abs",
        "ceil",
        "coalesce",
        "concat",
        "contains",
        "ends_with",
        "exp",
        "floor",
        "greatest",
        "if",
        "ifnull",
        "least",
        "length",
        "ln",
        "log",
        "lower",
        "lpad",
        "ltrim",
        "mod",
        "nullif",
        "power",
        "replace",
        "reverse",
        "round",
        "rpad",
        "rtrim",
        "safe_divide",
        "sign",
        "split_part",
        "sqrt",
        "starts_with",
        "substr",
        "to_float",
        "to_int",
        "to_string",
        "trim",
        "upper",
    }
)


def is_constant(expression: Expression) -> bool:
    """True when an expression can be evaluated without reading any row.

    An expression is constant when it contains no column references and no
    aggregates, and every function it calls is known to be pure.
    """
    for node in walk(expression):
        if isinstance(node, (ColumnRef, AggregateCall)):
            return False
        if isinstance(node, FunctionCall) and node.name not in _PURE_FUNCTIONS:
            return False
    return True


def as_constant(expression: Expression) -> Optional[Any]:
    """Return the value of a constant expression, or ``None`` when not constant.

    Because ``None`` is also a legitimate constant value, callers that need to
    distinguish the two should check :func:`is_constant` first.
    """
    if isinstance(expression, Literal):
        return expression.value
    if not is_constant(expression):
        return None
    folded = fold_constants(expression)
    return folded.value if isinstance(folded, Literal) else None


def fold_constants(expression: Expression) -> Expression:
    """Replace every constant sub-expression with a literal.

    Folding never raises: an expression that fails to evaluate (a bad cast, a
    domain error) is left alone so the failure surfaces at execution time with
    the row that caused it, rather than at planning time for every row.
    """

    def rule(node: Expression) -> Expression:
        if isinstance(node, Literal) or isinstance(node, Alias):
            return node
        if not is_constant(node):
            return node
        if isinstance(node, ColumnRef):
            return node
        try:
            from .evaluator import Evaluator

            value = Evaluator().evaluate_constant(node)
        except (VeldtError, ExecutionError, ValueError, TypeError, ArithmeticError):
            return node
        dtype = DataType.NULL if is_null(value) else infer_dtype(value)
        return Literal(value, dtype)

    return transform(expression, rule)


def simplify(expression: Expression) -> Expression:
    """Fold constants and apply local boolean and null identities."""
    folded = fold_constants(expression)
    return transform(folded, _simplify_node)


def _simplify_node(node: Expression) -> Expression:
    """Apply one round of local rewrites to a single node."""
    if isinstance(node, UnaryOp):
        return _simplify_unary(node)
    if isinstance(node, BinaryOp):
        return _simplify_binary(node)
    if isinstance(node, CaseWhen):
        return _simplify_case(node)
    if isinstance(node, InList):
        return _simplify_in_list(node)
    if isinstance(node, Between):
        return node
    if isinstance(node, Cast):
        if isinstance(node.child, Literal) and node.child.dtype == node.target:
            return node.child
        return node
    if isinstance(node, IsNull):
        if isinstance(node.child, Literal):
            result = is_null(node.child.value) != node.negated
            return TRUE if result else FALSE
        return node
    return node


def _simplify_unary(node: UnaryOp) -> Expression:
    if node.operator == "not":
        inner = node.operand
        if _is_true(inner):
            return FALSE
        if _is_false(inner):
            return TRUE
        if isinstance(inner, UnaryOp) and inner.operator == "not":
            return inner.operand
        if isinstance(inner, IsNull):
            return IsNull(inner.child, not inner.negated)
        if isinstance(inner, InList):
            return InList(inner.child, inner.options, not inner.negated)
        if isinstance(inner, Between):
            return Between(inner.child, inner.low, inner.high, not inner.negated)
    return node


def _simplify_binary(node: BinaryOp) -> Expression:
    left, right = node.left, node.right
    if node.operator == "and":
        if _is_false(left) or _is_false(right):
            return FALSE
        if _is_true(left):
            return right
        if _is_true(right):
            return left
        if left == right:
            return left
        return node
    if node.operator == "or":
        if _is_true(left) or _is_true(right):
            return TRUE
        if _is_false(left):
            return right
        if _is_false(right):
            return left
        if left == right:
            return left
        return node
    if node.is_arithmetic:
        return _simplify_arithmetic(node)
    if node.is_comparison and _is_null_literal(left) or (
        node.is_comparison and _is_null_literal(right)
    ):
        # Any comparison against NULL is unknown, which filters like false.
        return NULL
    return node


def _simplify_arithmetic(node: BinaryOp) -> Expression:
    """Apply the arithmetic identities that are always safe."""
    left, right = node.left, node.right
    if node.operator in ("+", "-") and _is_number(right, 0):
        return left
    if node.operator == "+" and _is_number(left, 0):
        return right
    if node.operator == "*":
        if _is_number(left, 1):
            return right
        if _is_number(right, 1):
            return left
    if node.operator == "/" and _is_number(right, 1):
        return left
    return node


def _simplify_case(node: CaseWhen) -> Expression:
    """Drop unreachable branches and collapse an always-true first branch."""
    branches: List[tuple] = []
    otherwise = node.otherwise
    for condition, result in node.branches:
        if _is_false(condition) or _is_null_literal(condition):
            continue
        if _is_true(condition):
            if not branches:
                return result
            otherwise = result
            break
        branches.append((condition, result))
    if not branches:
        return otherwise if otherwise is not None else NULL
    return CaseWhen(tuple(branches), otherwise)


def _simplify_in_list(node: InList) -> Expression:
    """Collapse a single-option ``IN`` into an equality test."""
    if len(node.options) == 1 and not _is_null_literal(node.options[0]):
        operator = "!=" if node.negated else "="
        return BinaryOp(operator, node.child, node.options[0])
    return node


# ----------------------------------------------------------------------
# Conjunction helpers
# ----------------------------------------------------------------------
def split_conjunction(expression: Optional[Expression]) -> List[Expression]:
    """Flatten nested ``AND`` nodes into a list of independent terms.

    ``None`` and a literal ``TRUE`` both flatten to an empty list, which lets
    callers treat "no predicate" and "always true" identically.
    """
    if expression is None or _is_true(expression):
        return []
    if isinstance(expression, BinaryOp) and expression.operator == "and":
        return split_conjunction(expression.left) + split_conjunction(expression.right)
    return [expression]


def combine_conjunction(terms: Sequence[Expression]) -> Optional[Expression]:
    """Rebuild an ``AND`` chain from terms, or ``None`` when there are none."""
    kept = [term for term in terms if not _is_true(term)]
    if not kept:
        return None
    combined = kept[0]
    for term in kept[1:]:
        combined = BinaryOp("and", combined, term)
    return combined


def split_disjunction(expression: Optional[Expression]) -> List[Expression]:
    """Flatten nested ``OR`` nodes into a list of alternatives."""
    if expression is None:
        return []
    if isinstance(expression, BinaryOp) and expression.operator == "or":
        return split_disjunction(expression.left) + split_disjunction(expression.right)
    return [expression]


def combine_disjunction(terms: Sequence[Expression]) -> Optional[Expression]:
    """Rebuild an ``OR`` chain from alternatives."""
    kept = list(terms)
    if not kept:
        return None
    combined = kept[0]
    for term in kept[1:]:
        combined = BinaryOp("or", combined, term)
    return combined


# ----------------------------------------------------------------------
# Literal predicates
# ----------------------------------------------------------------------
def _is_true(expression: Expression) -> bool:
    return isinstance(expression, Literal) and expression.value is True


def _is_false(expression: Expression) -> bool:
    return isinstance(expression, Literal) and expression.value is False


def _is_null_literal(expression: Expression) -> bool:
    return isinstance(expression, Literal) and expression.value is None


def _is_number(expression: Expression, target: float) -> bool:
    """True when the expression is a numeric literal equal to ``target``."""
    if not isinstance(expression, Literal):
        return False
    value = expression.value
    if value is None or isinstance(value, bool):
        return False
    return isinstance(value, (int, float)) and float(value) == target
