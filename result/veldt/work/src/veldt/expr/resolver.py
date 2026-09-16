"""Static type resolution for expressions.

Resolution runs during planning, before a single row is read. It answers two
questions for every expression: what type does it produce, and does it only
reference columns that actually exist? Getting both answered up front means a
malformed query fails immediately with a useful message instead of halfway
through a scan.
"""

from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator, List, Optional, Sequence, Tuple

from ..errors import ColumnNotFoundError, TypeMismatchError
from ..types.casting import can_cast
from ..types.dtypes import DataType, common_type, is_numeric, is_ordered, unify
from ..types.schema import Field, Schema
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
    output_name,
    walk,
)
from .functions import FunctionRegistry, default_registry

__all__ = [
    "ExpressionResolver",
    "active_registries",
    "current_aggregates",
    "current_functions",
    "resolve_type",
    "resolve_field",
    "resolve_schema",
    "validate_expression",
    "find_column",
]


# Registries a caller has made ambient for the duration of a planning pass.
# Plan nodes resolve their own schemas lazily and have nowhere to carry an
# engine's registries, so an engine publishes them here while it plans. The
# stack is a stack rather than a slot so nested planning restores cleanly.
_ACTIVE: List[Tuple[FunctionRegistry, AggregateRegistry]] = []


@contextmanager
def active_registries(
    functions: FunctionRegistry, aggregates: AggregateRegistry
) -> Iterator[None]:
    """Make these registries the default for resolution inside the block."""
    _ACTIVE.append((functions, aggregates))
    try:
        yield
    finally:
        _ACTIVE.pop()


def current_functions() -> Optional[FunctionRegistry]:
    """Return the ambient scalar registry, or ``None`` outside a block."""
    return _ACTIVE[-1][0] if _ACTIVE else None


def current_aggregates() -> Optional[AggregateRegistry]:
    """Return the ambient aggregate registry, or ``None`` outside a block."""
    return _ACTIVE[-1][1] if _ACTIVE else None


def find_column(schema: Schema, reference: ColumnRef) -> str:
    """Resolve a column reference to a concrete column name in ``schema``.

    A qualified reference such as ``t.amount`` first looks for a column
    literally named ``t.amount`` (which is how a scan can expose qualified
    names), then falls back to the bare ``amount``.

    Raises:
        ColumnNotFoundError: If neither spelling exists.
    """
    if reference.qualifier:
        qualified = f"{reference.qualifier}.{reference.name}"
        if schema.has(qualified):
            return schema.field(qualified).name
    if schema.has(reference.name):
        return schema.field(reference.name).name
    raise ColumnNotFoundError(reference.qualified_name, schema.names)


class ExpressionResolver:
    """Resolves expression types against a schema and two registries."""

    def __init__(
        self,
        functions: Optional[FunctionRegistry] = None,
        aggregates: Optional[AggregateRegistry] = None,
    ) -> None:
        self._functions = functions
        self._aggregates = aggregates

    @property
    def functions(self) -> FunctionRegistry:
        """The scalar registry: explicit, else ambient, else the built-ins."""
        if self._functions is not None:
            return self._functions
        return current_functions() or _builtin_functions()

    @property
    def aggregates(self) -> AggregateRegistry:
        """The aggregate registry, resolved the same way."""
        if self._aggregates is not None:
            return self._aggregates
        return current_aggregates() or _builtin_aggregates()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    def resolve(self, expression: Expression, schema: Schema) -> DataType:
        """Return the type ``expression`` produces over ``schema``.

        Raises:
            ColumnNotFoundError: If a referenced column does not exist.
            TypeMismatchError: If operand types are incompatible.
        """
        if isinstance(expression, Literal):
            return expression.dtype
        if isinstance(expression, ColumnRef):
            return schema.dtype_of(find_column(schema, expression))
        if isinstance(expression, Alias):
            return self.resolve(expression.child, schema)
        if isinstance(expression, Cast):
            return self._resolve_cast(expression, schema)
        if isinstance(expression, UnaryOp):
            return self._resolve_unary(expression, schema)
        if isinstance(expression, BinaryOp):
            return self._resolve_binary(expression, schema)
        if isinstance(expression, IsNull):
            self.resolve(expression.child, schema)
            return DataType.BOOL
        if isinstance(expression, InList):
            return self._resolve_in_list(expression, schema)
        if isinstance(expression, Between):
            return self._resolve_between(expression, schema)
        if isinstance(expression, CaseWhen):
            return self._resolve_case(expression, schema)
        if isinstance(expression, AggregateCall):
            return self._resolve_aggregate(expression, schema)
        if isinstance(expression, FunctionCall):
            return self._resolve_function(expression, schema)
        raise TypeMismatchError(f"cannot resolve expression of type {type(expression).__name__}")

    def resolve_field(self, expression: Expression, schema: Schema) -> Field:
        """Return the output field an expression contributes to a projection."""
        dtype = self.resolve(expression, schema)
        nullable = self._is_nullable(expression, schema)
        return Field(output_name(expression), dtype, nullable)

    def resolve_schema(self, expressions: Sequence[Expression], schema: Schema) -> Schema:
        """Return the schema produced by projecting ``expressions``.

        Duplicate output names are disambiguated with a numeric suffix so a
        projection like ``SELECT a, a`` still yields a valid schema.
        """
        fields: List[Field] = []
        taken: set = set()
        for expression in expressions:
            item = self.resolve_field(expression, schema)
            name = item.name
            counter = 1
            while name.lower() in taken:
                counter += 1
                name = f"{item.name}_{counter}"
            taken.add(name.lower())
            fields.append(item.rename(name) if name != item.name else item)
        return Schema(fields)

    def validate(self, expression: Expression, schema: Schema) -> None:
        """Resolve an expression purely for its side effect of checking it."""
        self.resolve(expression, schema)

    # ------------------------------------------------------------------
    # Node rules
    # ------------------------------------------------------------------
    def _resolve_cast(self, expression: Cast, schema: Schema) -> DataType:
        source = self.resolve(expression.child, schema)
        if not can_cast(source, expression.target):
            raise TypeMismatchError(
                f"cannot cast {source} to {expression.target}", operator="cast"
            )
        return expression.target

    def _resolve_unary(self, expression: UnaryOp, schema: Schema) -> DataType:
        operand = self.resolve(expression.operand, schema)
        if expression.operator == "not":
            if operand not in (DataType.BOOL, DataType.NULL):
                raise TypeMismatchError(
                    f"NOT requires a boolean operand, got {operand}", operator="not"
                )
            return DataType.BOOL
        if operand == DataType.NULL:
            return DataType.NULL
        if not is_numeric(operand):
            raise TypeMismatchError(
                f"unary {expression.operator} requires a numeric operand, got {operand}",
                operator=expression.operator,
            )
        return operand

    def _resolve_binary(self, expression: BinaryOp, schema: Schema) -> DataType:
        left = self.resolve(expression.left, schema)
        right = self.resolve(expression.right, schema)
        operator = expression.operator
        if operator in ("and", "or"):
            for dtype in (left, right):
                if dtype not in (DataType.BOOL, DataType.NULL):
                    raise TypeMismatchError(
                        f"{operator.upper()} requires boolean operands, got {dtype}",
                        operator=operator,
                    )
            return DataType.BOOL
        if operator in ("like", "not like"):
            for dtype in (left, right):
                if dtype not in (DataType.STRING, DataType.NULL):
                    raise TypeMismatchError(
                        f"LIKE requires string operands, got {dtype}", operator=operator
                    )
            return DataType.BOOL
        if operator == "||":
            return DataType.STRING
        if expression.is_comparison:
            merged = unify(left, right, context=operator)
            if merged != DataType.NULL and not is_ordered(merged) and operator not in ("=", "!="):
                raise TypeMismatchError(
                    f"{operator} is not defined for {merged}", operator=operator
                )
            return DataType.BOOL
        # Arithmetic.
        for dtype in (left, right):
            if dtype != DataType.NULL and not is_numeric(dtype):
                raise TypeMismatchError(
                    f"{operator} requires numeric operands, got {dtype}", operator=operator
                )
        if operator == "/":
            return DataType.FLOAT64
        return unify(left, right, context=operator)

    def _resolve_in_list(self, expression: InList, schema: Schema) -> DataType:
        value = self.resolve(expression.child, schema)
        for option in expression.options:
            unify(value, self.resolve(option, schema), context="in")
        return DataType.BOOL

    def _resolve_between(self, expression: Between, schema: Schema) -> DataType:
        value = self.resolve(expression.child, schema)
        low = self.resolve(expression.low, schema)
        high = self.resolve(expression.high, schema)
        unify(unify(value, low, context="between"), high, context="between")
        return DataType.BOOL

    def _resolve_case(self, expression: CaseWhen, schema: Schema) -> DataType:
        for condition, _ in expression.branches:
            dtype = self.resolve(condition, schema)
            if dtype not in (DataType.BOOL, DataType.NULL):
                raise TypeMismatchError(
                    f"CASE conditions must be boolean, got {dtype}", operator="case"
                )
        results = [self.resolve(result, schema) for _, result in expression.branches]
        if expression.otherwise is not None:
            results.append(self.resolve(expression.otherwise, schema))
        else:
            results.append(DataType.NULL)
        return common_type(results, context="case")

    def _resolve_aggregate(self, expression: AggregateCall, schema: Schema) -> DataType:
        function = self.aggregates.get(expression.name)
        arg_types = [self.resolve(argument, schema) for argument in expression.args]
        return function.resolve_type(arg_types)

    def _resolve_function(self, expression: FunctionCall, schema: Schema) -> DataType:
        function = self.functions.get(expression.name)
        arg_types = [self.resolve(argument, schema) for argument in expression.args]
        return function.resolve_type(arg_types)

    # ------------------------------------------------------------------
    # Nullability
    # ------------------------------------------------------------------
    def _is_nullable(self, expression: Expression, schema: Schema) -> bool:
        """Conservatively decide whether an expression can produce null.

        Only two shapes are known not to be nullable: a non-null literal, and a
        reference to a column declared ``NOT NULL``. Everything else is assumed
        nullable, which is always safe.
        """
        if isinstance(expression, Literal):
            return expression.value is None
        if isinstance(expression, ColumnRef):
            return schema.field(find_column(schema, expression)).nullable
        if isinstance(expression, Alias):
            return self._is_nullable(expression.child, schema)
        if isinstance(expression, IsNull):
            return False
        if isinstance(expression, BinaryOp) and expression.is_logical:
            return any(
                self._is_nullable(child, schema) for child in expression.children()
            )
        return True


_BUILTIN_FUNCTIONS: Optional[FunctionRegistry] = None
_BUILTIN_AGGREGATES: Optional[AggregateRegistry] = None


def _builtin_functions() -> FunctionRegistry:
    """Return the shared built-in scalar registry, building it once."""
    global _BUILTIN_FUNCTIONS
    if _BUILTIN_FUNCTIONS is None:
        _BUILTIN_FUNCTIONS = default_registry()
    return _BUILTIN_FUNCTIONS


def _builtin_aggregates() -> AggregateRegistry:
    """Return the shared built-in aggregate registry, building it once."""
    global _BUILTIN_AGGREGATES
    if _BUILTIN_AGGREGATES is None:
        _BUILTIN_AGGREGATES = default_aggregate_registry()
    return _BUILTIN_AGGREGATES


_DEFAULT_RESOLVER = ExpressionResolver()


def resolve_type(
    expression: Expression,
    schema: Schema,
    functions: Optional[FunctionRegistry] = None,
    aggregates: Optional[AggregateRegistry] = None,
) -> DataType:
    """Resolve one expression's type using the default registries."""
    if functions is None and aggregates is None:
        return _DEFAULT_RESOLVER.resolve(expression, schema)
    return ExpressionResolver(functions, aggregates).resolve(expression, schema)


def resolve_field(expression: Expression, schema: Schema) -> Field:
    """Resolve one expression's output field using the default registries."""
    return _DEFAULT_RESOLVER.resolve_field(expression, schema)


def resolve_schema(expressions: Sequence[Expression], schema: Schema) -> Schema:
    """Resolve a projection's output schema using the default registries."""
    return _DEFAULT_RESOLVER.resolve_schema(expressions, schema)


def validate_expression(expression: Expression, schema: Schema) -> None:
    """Check an expression against a schema, raising on any problem."""
    _DEFAULT_RESOLVER.validate(expression, schema)


def referenced_columns(expression: Expression, schema: Schema) -> List[str]:
    """Return the concrete schema column names an expression touches."""
    names: List[str] = []
    for node in walk(expression):
        if isinstance(node, ColumnRef):
            resolved = find_column(schema, node)
            if resolved not in names:
                names.append(resolved)
    return names
