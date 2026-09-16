"""Expression binding: AST expression -> typed plan expression.

Binding performs name resolution, function lookup, type inference, and the
small amount of desugaring that keeps the executor simple (``BETWEEN`` becomes
two comparisons; simple ``CASE`` becomes searched ``CASE``).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Callable, Optional, Sequence

from ..errors import BindingError, TypeMismatchError
from ..functions.registry import FunctionRegistry
from ..plan import expressions as X
from ..sql import ast_nodes as A
from ..sql.unparser import unparse
from ..types.coercion import (
    boolean_result,
    explicit_cast_allowed,
    require_boolean,
    require_comparable,
    require_numeric,
    result_of_arithmetic,
    unify,
)
from ..types.datatypes import (
    BOOLEAN,
    DOUBLE,
    INTEGER,
    NULL,
    DataType,
    parse_type_name,
    type_from_python,
)
from .scope import Scope

if TYPE_CHECKING:  # pragma: no cover - typing only
    from ..plan.logical import LogicalPlan

__all__ = ["ExpressionBinder", "SubqueryBinder", "derive_name"]

#: Binds a subquery statement against the scope that encloses it and returns
#: its plan together with the enclosing-query expressions it correlates on.
SubqueryBinder = Callable[[A.Statement, Scope], "tuple[LogicalPlan, tuple[X.Expr, ...]]"]

_COMPARISONS = frozenset({"=", "<>", "!=", "<", "<=", ">", ">="})
_ARITHMETIC = frozenset({"+", "-", "*", "/", "%", "||"})


class ExpressionBinder:
    """Binds AST expressions against a scope and a function registry."""

    def __init__(
        self,
        scope: Scope,
        registry: FunctionRegistry,
        *,
        allow_aggregates: bool = False,
        clause: str = "expression",
        subquery_binder: Optional[SubqueryBinder] = None,
    ) -> None:
        self.scope = scope
        self.registry = registry
        self.allow_aggregates = allow_aggregates
        self.clause = clause
        self.subquery_binder = subquery_binder

    def bind(self, node: A.Expression) -> X.Expr:
        """Bind ``node``, dispatching on its concrete type."""

        if isinstance(node, A.Literal):
            return self._bind_literal(node)
        if isinstance(node, A.ColumnRef):
            return self.scope.lookup(node.name, node.qualifier)
        if isinstance(node, A.UnaryOp):
            return self._bind_unary(node)
        if isinstance(node, A.BinaryOp):
            return self._bind_binary(node)
        if isinstance(node, A.FunctionCall):
            return self._bind_call(node)
        if isinstance(node, A.Cast):
            return self._bind_cast(node)
        if isinstance(node, A.CaseExpr):
            return self._bind_case(node)
        if isinstance(node, A.InList):
            return self._bind_in_list(node)
        if isinstance(node, A.Between):
            return self._bind_between(node)
        if isinstance(node, A.IsNull):
            return self._bind_is_null(node)
        if isinstance(node, A.LikeExpr):
            return self._bind_like(node)
        if isinstance(node, A.Subquery):
            return self._bind_scalar_subquery(node)
        if isinstance(node, A.InSubquery):
            return self._bind_in_subquery(node)
        if isinstance(node, A.Exists):
            return self._bind_exists(node)
        raise BindingError(f"cannot bind expression node {type(node).__name__}")

    # -- leaves ----------------------------------------------------------

    def _bind_literal(self, node: A.Literal) -> X.Expr:
        if node.value is None:
            return X.Literal(value=None, dtype=NULL)
        dtype = type_from_python(node.value).as_nullable(False)
        return X.Literal(value=node.value, dtype=dtype)

    # -- operators -------------------------------------------------------

    def _bind_unary(self, node: A.UnaryOp) -> X.Expr:
        operand = self.bind(node.operand)
        if node.op == "NOT":
            require_boolean(operand.dtype, context="NOT")
            return X.UnaryExpr(
                op="NOT", operand=operand, dtype=boolean_result([operand.dtype])
            )
        require_numeric(operand.dtype, context=f"unary {node.op}")
        if node.op == "+":
            return operand
        return X.UnaryExpr(op="-", operand=operand, dtype=operand.dtype)

    def _bind_binary(self, node: A.BinaryOp) -> X.Expr:
        left = self.bind(node.left)
        right = self.bind(node.right)
        op = node.op
        if op in ("AND", "OR"):
            require_boolean(left.dtype, context=op)
            require_boolean(right.dtype, context=op)
            return X.BinaryExpr(
                op=op,
                left=left,
                right=right,
                dtype=boolean_result([left.dtype, right.dtype]),
            )
        if op in _COMPARISONS:
            require_comparable(left.dtype, right.dtype, context=f"comparison {op}")
            normalised = "<>" if op == "!=" else op
            return X.BinaryExpr(
                op=normalised,
                left=left,
                right=right,
                dtype=boolean_result([left.dtype, right.dtype]),
            )
        if op in _ARITHMETIC:
            dtype = result_of_arithmetic(op, left.dtype, right.dtype)
            return X.BinaryExpr(op=op, left=left, right=right, dtype=dtype)
        raise BindingError(f"unsupported operator {op!r}")

    # -- calls -----------------------------------------------------------

    def _bind_call(self, node: A.FunctionCall) -> X.Expr:
        name = node.name.lower()
        if self.registry.is_aggregate(name):
            return self._bind_aggregate(node)
        if node.star:
            raise BindingError(f"{name}(*) is only valid for aggregate functions")
        if node.distinct:
            raise BindingError(f"DISTINCT is not supported by {name}()")
        definition = self.registry.scalar(name)
        args = [self.bind(arg) for arg in node.args]
        dtype = definition.return_type([arg.dtype for arg in args])
        return X.ScalarFunction(
            name=definition.name,
            args=tuple(args),
            dtype=dtype,
            volatile=definition.volatile,
        )

    def _bind_aggregate(self, node: A.FunctionCall) -> X.Expr:
        name = node.name.lower()
        if not self.allow_aggregates:
            raise BindingError(
                f"aggregate function {name}() is not allowed in {self.clause}",
                hint="aggregates may appear in SELECT, HAVING and ORDER BY",
            )
        definition = self.registry.aggregate(name)
        if node.star and not definition.accepts_star:
            raise BindingError(f"{name}(*) is not supported")
        args = [self.bind(arg) for arg in node.args]
        for arg in args:
            if X.contains_aggregate(arg):
                raise BindingError("aggregate functions cannot be nested")
        if node.distinct:
            definition.require_distinct_supported()
        dtype = definition.return_type([arg.dtype for arg in args])
        return X.AggregateCall(
            name=definition.name,
            args=tuple(args),
            dtype=dtype,
            distinct=node.distinct,
            star=node.star,
        )

    def _bind_cast(self, node: A.Cast) -> X.Expr:
        operand = self.bind(node.operand)
        target = parse_type_name(node.type_name)
        if not explicit_cast_allowed(operand.dtype, target):
            raise TypeMismatchError(
                f"cannot cast {operand.dtype} to {target.name}",
            )
        return X.CastExpr(operand=operand, dtype=target.as_nullable(True))

    # -- compound forms --------------------------------------------------

    def _bind_case(self, node: A.CaseExpr) -> X.Expr:
        operand = self.bind(node.operand) if node.operand is not None else None
        branches: list[X.CaseBranch] = []
        results: list[DataType] = []
        for when in node.whens:
            if operand is None:
                condition = self.bind(when.condition)
                require_boolean(condition.dtype, context="CASE WHEN")
            else:
                comparand = self.bind(when.condition)
                require_comparable(
                    operand.dtype, comparand.dtype, context="CASE operand"
                )
                condition = X.BinaryExpr(
                    op="=",
                    left=operand,
                    right=comparand,
                    dtype=boolean_result([operand.dtype, comparand.dtype]),
                )
            result = self.bind(when.result)
            results.append(result.dtype)
            branches.append(X.CaseBranch(condition=condition, result=result))
        default = self.bind(node.default) if node.default is not None else None
        if default is not None:
            results.append(default.dtype)
        dtype = unify(results, context="CASE").as_nullable(True)
        return X.CaseExpr(branches=tuple(branches), dtype=dtype, default=default)

    def _bind_in_list(self, node: A.InList) -> X.Expr:
        operand = self.bind(node.operand)
        items = [self.bind(item) for item in node.items]
        for item in items:
            require_comparable(operand.dtype, item.dtype, context="IN list")
        types = [operand.dtype, *(item.dtype for item in items)]
        return X.InList(
            operand=operand,
            items=tuple(items),
            dtype=boolean_result(types),
            negated=node.negated,
        )

    def _bind_between(self, node: A.Between) -> X.Expr:
        """Desugar BETWEEN into two comparisons joined by AND (or OR when
        negated), which lets predicate pushdown treat each bound separately."""

        operand = self.bind(node.operand)
        low = self.bind(node.low)
        high = self.bind(node.high)
        require_comparable(operand.dtype, low.dtype, context="BETWEEN lower bound")
        require_comparable(operand.dtype, high.dtype, context="BETWEEN upper bound")
        dtype = boolean_result([operand.dtype, low.dtype, high.dtype])
        if node.negated:
            return X.BinaryExpr(
                op="OR",
                left=X.BinaryExpr(op="<", left=operand, right=low, dtype=dtype),
                right=X.BinaryExpr(op=">", left=operand, right=high, dtype=dtype),
                dtype=dtype,
            )
        return X.BinaryExpr(
            op="AND",
            left=X.BinaryExpr(op=">=", left=operand, right=low, dtype=dtype),
            right=X.BinaryExpr(op="<=", left=operand, right=high, dtype=dtype),
            dtype=dtype,
        )

    def _bind_is_null(self, node: A.IsNull) -> X.Expr:
        operand = self.bind(node.operand)
        return X.IsNull(
            operand=operand,
            dtype=BOOLEAN.as_nullable(False),
            negated=node.negated,
        )

    def _bind_like(self, node: A.LikeExpr) -> X.Expr:
        operand = self.bind(node.operand)
        pattern = self.bind(node.pattern)
        escape = self.bind(node.escape) if node.escape is not None else None
        for expression, label in ((operand, "LIKE operand"), (pattern, "LIKE pattern")):
            if not (expression.dtype.is_null or expression.dtype.kind.value == "string"):
                raise TypeMismatchError(
                    f"{label} must be a string, got {expression.dtype}"
                )
        types = [operand.dtype, pattern.dtype]
        return X.LikeMatch(
            operand=operand,
            pattern=pattern,
            dtype=boolean_result(types),
            negated=node.negated,
            escape=escape,
        )


    # -- subqueries ------------------------------------------------------

    def _bind_subquery_plan(
        self, statement: A.Statement, form: str, *, single_column: bool
    ) -> "tuple[LogicalPlan, tuple[X.Expr, ...]]":
        if self.subquery_binder is None:
            raise BindingError(f"a subquery is not allowed in {self.clause}")
        plan, bindings = self.subquery_binder(statement, self.scope)
        if single_column and len(plan.schema) != 1:
            raise BindingError(
                f"{form} must produce exactly one column, got {len(plan.schema)}",
                hint="project a single expression in the subquery",
            )
        return plan, bindings

    def _bind_scalar_subquery(self, node: A.Subquery) -> X.Expr:
        plan, bindings = self._bind_subquery_plan(
            node.statement, "a scalar subquery", single_column=True
        )
        return X.ScalarSubquery(
            plan=plan,
            bindings=bindings,
            dtype=plan.schema[0].dtype.as_nullable(True),
            text=unparse(node),
        )

    def _bind_in_subquery(self, node: A.InSubquery) -> X.Expr:
        operand = self.bind(node.operand)
        plan, bindings = self._bind_subquery_plan(
            node.statement, "an IN subquery", single_column=True
        )
        column_type = plan.schema[0].dtype
        require_comparable(operand.dtype, column_type, context="IN subquery")
        return X.InSubquery(
            plan=plan,
            bindings=bindings,
            dtype=boolean_result([operand.dtype, column_type]),
            text=f"({unparse(node.statement)})",
            operand=operand,
            negated=node.negated,
        )

    def _bind_exists(self, node: A.Exists) -> X.Expr:
        plan, bindings = self._bind_subquery_plan(
            node.statement, "EXISTS", single_column=False
        )
        return X.ExistsSubquery(
            plan=plan,
            bindings=bindings,
            dtype=BOOLEAN.as_nullable(False),
            text=f"({unparse(node.statement)})",
        )


def derive_name(expression: X.Expr, fallback: str = "expr") -> str:
    """Pick the output column name for an unaliased select-list item.

    The rules mirror what users expect: a column keeps its own name, an
    aggregate is named after its call, and anything else falls back to the
    expression's SQL text so that the name is at least stable.
    """

    if isinstance(expression, X.Column):
        return expression.name
    if isinstance(expression, X.AggregateCall):
        return expression.output_name()
    if isinstance(expression, X.ScalarFunction):
        return expression.name.lower()
    if isinstance(expression, X.CastExpr):
        return derive_name(expression.operand, fallback)
    if isinstance(expression, X.Literal):
        return expression.to_sql()
    if isinstance(expression, X.CaseExpr):
        return "case"
    if isinstance(expression, X.ScalarSubquery):
        return expression.plan.schema[0].name
    text = expression.to_sql()
    return text if text else fallback


def numeric_literal_type(value: object) -> DataType:
    """Type of a Python numeric literal, used when folding constants."""

    if isinstance(value, bool):
        return BOOLEAN.as_nullable(False)
    if isinstance(value, int):
        return INTEGER.as_nullable(False)
    if isinstance(value, float):
        return DOUBLE.as_nullable(False)
    return NULL


def check_predicate(expression: X.Expr, clause: str) -> None:
    """Assert that ``expression`` is usable as a filter predicate."""

    if expression.dtype.is_null:
        return
    if expression.dtype.kind is not BOOLEAN.kind:
        raise TypeMismatchError(
            f"{clause} requires a boolean expression, got {expression.dtype}"
        )


def bind_all(
    binder: ExpressionBinder, nodes: Sequence[A.Expression]
) -> list[X.Expr]:
    """Bind a sequence of expressions with one binder."""

    return [binder.bind(node) for node in nodes]


def optional_bind(
    binder: ExpressionBinder, node: Optional[A.Expression]
) -> Optional[X.Expr]:
    """Bind ``node`` when present."""

    return None if node is None else binder.bind(node)
