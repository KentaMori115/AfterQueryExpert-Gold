"""Render an AST back into SQL text.

Round-tripping matters for two reasons: EXPLAIN output embeds the textual form
of residual predicates, and the CLI echoes a normalised version of the query
when ``--echo`` is passed.  The unparser always emits fully parenthesised
binary expressions so that the result re-parses to an identical tree.
"""

from __future__ import annotations

from typing import Optional

from ..util.text import quote_identifier
from .ast_nodes import (
    Between,
    BinaryOp,
    CaseExpr,
    Cast,
    ColumnRef,
    DerivedTable,
    Exists,
    ExplainStatement,
    Expression,
    FunctionCall,
    InList,
    InSubquery,
    IsNull,
    JoinClause,
    LikeExpr,
    Literal,
    NamedTable,
    Node,
    OrderByItem,
    Projection,
    SelectStatement,
    SetOperation,
    ShowStatement,
    StarProjection,
    Statement,
    Subquery,
    TableRef,
    UnaryOp,
)

__all__ = ["unparse", "unparse_expression", "literal_sql"]


def literal_sql(value: object) -> str:
    """Render a Python value as a SQL literal."""

    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, (int, float)):
        return repr(value)
    text = str(value).replace("'", "''")
    return f"'{text}'"


def unparse_expression(expression: Expression) -> str:
    """Render a single expression."""

    if isinstance(expression, Literal):
        return literal_sql(expression.value)
    if isinstance(expression, ColumnRef):
        if expression.qualifier:
            return (
                f"{quote_identifier(expression.qualifier)}."
                f"{quote_identifier(expression.name)}"
            )
        return quote_identifier(expression.name)
    if isinstance(expression, UnaryOp):
        inner = unparse_expression(expression.operand)
        if expression.op == "NOT":
            return f"(NOT {inner})"
        return f"({expression.op}{inner})"
    if isinstance(expression, BinaryOp):
        left = unparse_expression(expression.left)
        right = unparse_expression(expression.right)
        return f"({left} {expression.op} {right})"
    if isinstance(expression, FunctionCall):
        return _unparse_function(expression)
    if isinstance(expression, Cast):
        inner = unparse_expression(expression.operand)
        return f"CAST({inner} AS {expression.type_name.upper()})"
    if isinstance(expression, CaseExpr):
        return _unparse_case(expression)
    if isinstance(expression, InList):
        items = ", ".join(unparse_expression(item) for item in expression.items)
        keyword = "NOT IN" if expression.negated else "IN"
        return f"({unparse_expression(expression.operand)} {keyword} ({items}))"
    if isinstance(expression, Between):
        keyword = "NOT BETWEEN" if expression.negated else "BETWEEN"
        return (
            f"({unparse_expression(expression.operand)} {keyword} "
            f"{unparse_expression(expression.low)} AND "
            f"{unparse_expression(expression.high)})"
        )
    if isinstance(expression, IsNull):
        keyword = "IS NOT NULL" if expression.negated else "IS NULL"
        return f"({unparse_expression(expression.operand)} {keyword})"
    if isinstance(expression, LikeExpr):
        keyword = "NOT LIKE" if expression.negated else "LIKE"
        text = (
            f"({unparse_expression(expression.operand)} {keyword} "
            f"{unparse_expression(expression.pattern)}"
        )
        if expression.escape is not None:
            text += f" ESCAPE {unparse_expression(expression.escape)}"
        return text + ")"
    if isinstance(expression, Subquery):
        return f"({unparse(expression.statement)})"
    if isinstance(expression, InSubquery):
        keyword = "NOT IN" if expression.negated else "IN"
        return (
            f"({unparse_expression(expression.operand)} {keyword} "
            f"({unparse(expression.statement)}))"
        )
    if isinstance(expression, Exists):
        return f"EXISTS ({unparse(expression.statement)})"
    raise TypeError(f"cannot unparse expression node {type(expression).__name__}")


def _unparse_function(call: FunctionCall) -> str:
    name = call.name.upper()
    if call.star:
        return f"{name}(*)"
    prefix = "DISTINCT " if call.distinct else ""
    args = ", ".join(unparse_expression(arg) for arg in call.args)
    return f"{name}({prefix}{args})"


def _unparse_case(case: CaseExpr) -> str:
    parts = ["CASE"]
    if case.operand is not None:
        parts.append(unparse_expression(case.operand))
    for when in case.whens:
        parts.append(
            f"WHEN {unparse_expression(when.condition)} "
            f"THEN {unparse_expression(when.result)}"
        )
    if case.default is not None:
        parts.append(f"ELSE {unparse_expression(case.default)}")
    parts.append("END")
    return " ".join(parts)


def _unparse_table(ref: TableRef) -> str:
    if isinstance(ref, NamedTable):
        text = quote_identifier(ref.name)
        if ref.alias:
            text += f" AS {quote_identifier(ref.alias)}"
        return text
    if isinstance(ref, DerivedTable):
        return f"({unparse(ref.statement)}) AS {quote_identifier(ref.alias)}"
    if isinstance(ref, JoinClause):
        left = _unparse_table(ref.left)
        right = _unparse_table(ref.right)
        text = f"{left} {ref.kind.sql()} {right}"
        if ref.condition is not None:
            text += f" ON {unparse_expression(ref.condition)}"
        elif ref.using:
            names = ", ".join(quote_identifier(name) for name in ref.using)
            text += f" USING ({names})"
        return text
    raise TypeError(f"cannot unparse table reference {type(ref).__name__}")


def _unparse_order_item(item: OrderByItem) -> str:
    text = unparse_expression(item.expression)
    text += " DESC" if item.descending else " ASC"
    if item.nulls_first is not None:
        text += " NULLS FIRST" if item.nulls_first else " NULLS LAST"
    return text


def _unparse_select(statement: SelectStatement) -> str:
    parts = ["SELECT"]
    if statement.distinct:
        parts.append("DISTINCT")
    columns: list[str] = []
    for item in statement.projections:
        if isinstance(item, StarProjection):
            columns.append(
                f"{quote_identifier(item.qualifier)}.*" if item.qualifier else "*"
            )
        elif isinstance(item, Projection):
            text = unparse_expression(item.expression)
            if item.alias:
                text += f" AS {quote_identifier(item.alias)}"
            columns.append(text)
    parts.append(", ".join(columns))
    if statement.source is not None:
        parts.append("FROM " + _unparse_table(statement.source))
    if statement.where is not None:
        parts.append("WHERE " + unparse_expression(statement.where))
    if statement.group_by:
        grouped = ", ".join(unparse_expression(item) for item in statement.group_by)
        parts.append("GROUP BY " + grouped)
    if statement.having is not None:
        parts.append("HAVING " + unparse_expression(statement.having))
    parts.append(_trailing_sql(statement.order_by, statement.limit, statement.offset))
    return " ".join(part for part in parts if part)


def _trailing_sql(
    order_by: tuple[OrderByItem, ...],
    limit: Optional[Expression],
    offset: Optional[Expression],
) -> str:
    parts: list[str] = []
    if order_by:
        parts.append(
            "ORDER BY " + ", ".join(_unparse_order_item(item) for item in order_by)
        )
    if limit is not None:
        parts.append("LIMIT " + unparse_expression(limit))
    if offset is not None:
        parts.append("OFFSET " + unparse_expression(offset))
    return " ".join(parts)


def unparse(node: Node) -> str:
    """Render a statement (or expression) as SQL text."""

    if isinstance(node, SelectStatement):
        return _unparse_select(node)
    if isinstance(node, SetOperation):
        left = unparse(node.left)
        right = unparse(node.right)
        text = f"{left} {node.kind.sql(node.all_rows)} {right}"
        trailing = _trailing_sql(node.order_by, node.limit, node.offset)
        return f"{text} {trailing}".strip()
    if isinstance(node, ExplainStatement):
        prefix = "EXPLAIN VERBOSE" if node.verbose else "EXPLAIN"
        return f"{prefix} {unparse(node.statement)}"
    if isinstance(node, ShowStatement):
        if node.target == "tables":
            return "SHOW TABLES"
        return f"SHOW COLUMNS FROM {quote_identifier(node.table or '')}"
    if isinstance(node, Expression):
        return unparse_expression(node)
    if isinstance(node, Statement):
        raise TypeError(f"cannot unparse statement {type(node).__name__}")
    raise TypeError(f"cannot unparse node {type(node).__name__}")
