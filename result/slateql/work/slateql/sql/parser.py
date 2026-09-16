"""Recursive-descent parser with Pratt-style expression parsing.

The grammar covers the SlateQL subset of SQL:

.. code-block:: text

    statement   := explain | show | query
    query       := select ( UNION [ALL] select )* [order_by] [limit] [offset]
    select      := SELECT [DISTINCT] select_list [FROM from_item]
                   [WHERE expr] [GROUP BY expr_list [HAVING expr]]
                   [ORDER BY sort_list] [LIMIT n] [OFFSET n]
    from_item   := table_ref ( join_op table_ref [ON expr | USING (cols)] )*

Errors carry the position of the offending token so the CLI can print a caret.
"""

from __future__ import annotations

from dataclasses import replace
from typing import Optional, Sequence

from ..errors import ParseError
from .ast_nodes import (
    Between,
    BinaryOp,
    CaseExpr,
    Cast,
    ColumnRef,
    ExplainStatement,
    Expression,
    FunctionCall,
    InList,
    IsNull,
    JoinClause,
    JoinKind,
    LikeExpr,
    Literal,
    NamedTable,
    OrderByItem,
    Projection,
    SelectItem,
    SelectStatement,
    SetOperation,
    SetOpKind,
    ShowStatement,
    StarProjection,
    Statement,
    TableRef,
    UnaryOp,
    WhenClause,
)
from .keywords import TYPE_KEYWORDS, is_reserved
from .lexer import tokenize
from .tokens import Token, TokenType

__all__ = ["Parser", "parse", "parse_expression"]

# Binding powers for infix operators.  Higher binds tighter.
_PRECEDENCE: dict[str, int] = {
    "OR": 1,
    "AND": 2,
    "=": 4,
    "<>": 4,
    "!=": 4,
    "<": 4,
    "<=": 4,
    ">": 4,
    ">=": 4,
    "||": 5,
    "+": 6,
    "-": 6,
    "*": 7,
    "/": 7,
    "%": 7,
}

_COMPARISON_LEVEL = 4
_UNARY_LEVEL = 8

_JOIN_KEYWORD_TO_KIND = {
    "INNER": JoinKind.INNER,
    "LEFT": JoinKind.LEFT,
    "RIGHT": JoinKind.RIGHT,
    "FULL": JoinKind.FULL,
    "CROSS": JoinKind.CROSS,
}


class Parser:
    """Parses one statement from a token stream."""

    def __init__(self, source: str, *, fold_identifiers: bool = True) -> None:
        self.source = source
        self._tokens = tokenize(source, fold_identifiers=fold_identifiers)
        self._index = 0

    # -- token helpers ---------------------------------------------------

    @property
    def current(self) -> Token:
        return self._tokens[self._index]

    def _peek(self, offset: int = 1) -> Token:
        index = min(self._index + offset, len(self._tokens) - 1)
        return self._tokens[index]

    def _advance(self) -> Token:
        token = self._tokens[self._index]
        if not token.is_eof:
            self._index += 1
        return token

    def _match_keyword(self, *words: str) -> bool:
        if self.current.is_keyword(*words):
            self._advance()
            return True
        return False

    def _match_punctuation(self, *symbols: str) -> bool:
        if self.current.is_punctuation(*symbols):
            self._advance()
            return True
        return False

    def _expect_keyword(self, word: str) -> Token:
        if not self.current.is_keyword(word):
            raise self._error(f"expected {word}, found {self.current.describe()}")
        return self._advance()

    def _expect_punctuation(self, symbol: str) -> Token:
        if not self.current.is_punctuation(symbol):
            raise self._error(
                f"expected {symbol!r}, found {self.current.describe()}"
            )
        return self._advance()

    def _error(self, message: str, *, hint: Optional[str] = None) -> ParseError:
        token = self.current
        return ParseError(
            message,
            position=token.position,
            line=token.line,
            column=token.column,
            hint=hint,
        )

    # -- entry points ----------------------------------------------------

    def parse_statement(self) -> Statement:
        """Parse a single statement and require the input to be exhausted."""

        statement = self._parse_statement_body()
        self._match_punctuation(";")
        if not self.current.is_eof:
            raise self._error(
                f"unexpected trailing input at {self.current.describe()}",
                hint="SlateQL executes one statement at a time",
            )
        return statement

    def parse_standalone_expression(self) -> Expression:
        """Parse a bare expression, used by tests and by ``--filter`` flags."""

        expression = self._parse_expression()
        if not self.current.is_eof:
            raise self._error(f"unexpected input at {self.current.describe()}")
        return expression

    def _parse_statement_body(self) -> Statement:
        if self.current.is_keyword("EXPLAIN"):
            return self._parse_explain()
        if self.current.is_keyword("SHOW", "DESCRIBE"):
            return self._parse_show()
        return self._parse_query()

    def _parse_explain(self) -> ExplainStatement:
        self._expect_keyword("EXPLAIN")
        verbose = False
        if self.current.type is TokenType.IDENTIFIER and self.current.value == "verbose":
            self._advance()
            verbose = True
        return ExplainStatement(statement=self._parse_query(), verbose=verbose)

    def _parse_show(self) -> ShowStatement:
        token = self._advance()
        if token.is_keyword("DESCRIBE"):
            name = self._parse_object_name()
            return ShowStatement(target="columns", table=name)
        if self._match_keyword("TABLES"):
            return ShowStatement(target="tables")
        if self._match_keyword("INDEXES"):
            if self._match_keyword("FROM"):
                return ShowStatement(target="indexes", table=self._parse_object_name())
            return ShowStatement(target="indexes")
        if self._match_keyword("COLUMNS"):
            self._expect_keyword("FROM")
            return ShowStatement(target="columns", table=self._parse_object_name())
        raise self._error(
            f"unsupported SHOW target {self.current.describe()}",
            hint="try SHOW TABLES, SHOW COLUMNS FROM <table> or SHOW INDEXES",
        )

    # -- query level -----------------------------------------------------

    def _parse_query(self) -> Statement:
        """Parse a query body plus the trailing ORDER BY / LIMIT / OFFSET.

        Trailing clauses always bind to the *whole* query, so in
        ``SELECT a FROM t UNION SELECT b FROM u ORDER BY 1`` the sort applies
        to the union rather than to its right arm.  Wrapping an arm in
        parentheses restores per-arm binding.
        """

        statement: Statement = self._parse_select(allow_trailing=False)
        while self.current.is_keyword("UNION"):
            self._advance()
            all_rows = self._match_keyword("ALL")
            right = self._parse_select(allow_trailing=False)
            statement = SetOperation(
                kind=SetOpKind.UNION,
                left=statement,
                right=right,
                all_rows=all_rows,
            )
        order_by = self._parse_order_by()
        limit, offset = self._parse_limit_offset()
        if not order_by and limit is None and offset is None:
            return statement
        return _attach_trailing(statement, order_by, limit, offset)

    def _parse_select(self, *, allow_trailing: bool = True) -> SelectStatement:
        if self._match_punctuation("("):
            inner = self._parse_select(allow_trailing=True)
            self._expect_punctuation(")")
            return inner

        self._expect_keyword("SELECT")
        distinct = False
        if self._match_keyword("DISTINCT"):
            distinct = True
        else:
            self._match_keyword("ALL")

        projections = self._parse_select_list()
        source = self._parse_from_clause()
        where = self._parse_where_clause()
        group_by, having = self._parse_group_by_clause()
        order_by = self._parse_order_by() if allow_trailing else ()
        limit, offset = (
            self._parse_limit_offset() if allow_trailing else (None, None)
        )

        return SelectStatement(
            projections=projections,
            source=source,
            where=where,
            group_by=group_by,
            having=having,
            order_by=order_by,
            limit=limit,
            offset=offset,
            distinct=distinct,
        )

    def _parse_select_list(self) -> tuple[SelectItem, ...]:
        items: list[SelectItem] = [self._parse_select_item()]
        while self._match_punctuation(","):
            items.append(self._parse_select_item())
        return tuple(items)

    def _parse_select_item(self) -> SelectItem:
        if self.current.is_operator("*"):
            self._advance()
            return StarProjection()
        if (
            self.current.type in (TokenType.IDENTIFIER, TokenType.QUOTED_IDENTIFIER)
            and self._peek(1).is_punctuation(".")
            and self._peek(2).is_operator("*")
        ):
            qualifier = self._advance().value
            self._advance()  # dot
            self._advance()  # star
            return StarProjection(qualifier=qualifier)

        expression = self._parse_expression()
        alias = self._parse_optional_alias()
        return Projection(expression=expression, alias=alias)

    def _parse_optional_alias(self) -> Optional[str]:
        if self._match_keyword("AS"):
            return self._parse_identifier(context="alias")
        token = self.current
        if token.type is TokenType.QUOTED_IDENTIFIER:
            return self._advance().value
        if token.type is TokenType.IDENTIFIER:
            return self._advance().value
        if token.type is TokenType.KEYWORD and not is_reserved(str(token.value)):
            return str(self._advance().value).lower()
        return None

    def _parse_from_clause(self) -> Optional[TableRef]:
        if not self._match_keyword("FROM"):
            return None
        source = self._parse_table_ref()
        while True:
            join = self._try_parse_join(source)
            if join is None:
                break
            source = join
        return source

    def _try_parse_join(self, left: TableRef) -> Optional[TableRef]:
        token = self.current
        if token.is_punctuation(","):
            self._advance()
            right = self._parse_table_ref()
            return JoinClause(kind=JoinKind.CROSS, left=left, right=right)
        if token.type is not TokenType.KEYWORD:
            return None
        word = str(token.value)
        if word == "JOIN":
            self._advance()
            return self._finish_join(JoinKind.INNER, left)
        if word in _JOIN_KEYWORD_TO_KIND:
            self._advance()
            kind = _JOIN_KEYWORD_TO_KIND[word]
            self._match_keyword("OUTER")
            self._expect_keyword("JOIN")
            return self._finish_join(kind, left)
        return None

    def _finish_join(self, kind: JoinKind, left: TableRef) -> TableRef:
        right = self._parse_table_ref()
        condition: Optional[Expression] = None
        using: tuple[str, ...] = ()
        if self._match_keyword("ON"):
            condition = self._parse_expression()
        elif self._match_keyword("USING"):
            self._expect_punctuation("(")
            names = [self._parse_identifier(context="USING column")]
            while self._match_punctuation(","):
                names.append(self._parse_identifier(context="USING column"))
            self._expect_punctuation(")")
            using = tuple(names)
        elif kind is not JoinKind.CROSS:
            raise self._error(
                f"{kind.sql()} requires an ON or USING clause",
                hint="use CROSS JOIN for an unconditional join",
            )
        if kind is JoinKind.CROSS and (condition is not None or using):
            raise self._error("CROSS JOIN does not accept a join condition")
        return JoinClause(
            kind=kind, left=left, right=right, condition=condition, using=using
        )

    def _parse_table_ref(self) -> TableRef:
        if self._match_punctuation("("):
            inner = self._parse_table_ref()
            while True:
                join = self._try_parse_join(inner)
                if join is None:
                    break
                inner = join
            self._expect_punctuation(")")
            return inner
        name = self._parse_object_name()
        alias = self._parse_optional_table_alias()
        return NamedTable(name=name, alias=alias)

    def _parse_optional_table_alias(self) -> Optional[str]:
        if self._match_keyword("AS"):
            return self._parse_identifier(context="table alias")
        token = self.current
        if token.type in (TokenType.IDENTIFIER, TokenType.QUOTED_IDENTIFIER):
            return self._advance().value
        return None

    def _parse_where_clause(self) -> Optional[Expression]:
        if not self._match_keyword("WHERE"):
            return None
        return self._parse_expression()

    def _parse_group_by_clause(
        self,
    ) -> tuple[tuple[Expression, ...], Optional[Expression]]:
        if not self._match_keyword("GROUP"):
            return (), self._parse_having_clause()
        self._expect_keyword("BY")
        items = [self._parse_expression()]
        while self._match_punctuation(","):
            items.append(self._parse_expression())
        return tuple(items), self._parse_having_clause()

    def _parse_having_clause(self) -> Optional[Expression]:
        if not self._match_keyword("HAVING"):
            return None
        return self._parse_expression()

    def _parse_order_by(self) -> tuple[OrderByItem, ...]:
        if not self.current.is_keyword("ORDER"):
            return ()
        self._advance()
        self._expect_keyword("BY")
        items = [self._parse_order_item()]
        while self._match_punctuation(","):
            items.append(self._parse_order_item())
        return tuple(items)

    def _parse_order_item(self) -> OrderByItem:
        expression = self._parse_expression()
        descending = False
        if self._match_keyword("DESC"):
            descending = True
        else:
            self._match_keyword("ASC")
        nulls_first: Optional[bool] = None
        if self._match_keyword("NULLS"):
            if self._match_keyword("FIRST"):
                nulls_first = True
            elif self._match_keyword("LAST"):
                nulls_first = False
            else:
                raise self._error("expected FIRST or LAST after NULLS")
        return OrderByItem(
            expression=expression, descending=descending, nulls_first=nulls_first
        )

    def _parse_limit_offset(self) -> tuple[Optional[Expression], Optional[Expression]]:
        limit: Optional[Expression] = None
        offset: Optional[Expression] = None
        if self._match_keyword("LIMIT"):
            limit = self._parse_row_count("LIMIT")
        if self._match_keyword("OFFSET"):
            offset = self._parse_row_count("OFFSET")
        if limit is None and self.current.is_keyword("LIMIT"):
            self._advance()
            limit = self._parse_row_count("LIMIT")
        return limit, offset

    def _parse_row_count(self, clause: str) -> Expression:
        token = self.current
        if token.type is not TokenType.NUMBER:
            raise self._error(f"{clause} requires an integer literal")
        if not isinstance(token.value, int):
            raise self._error(f"{clause} requires an integer, got {token.text}")
        if token.value < 0:
            raise self._error(f"{clause} must not be negative")
        self._advance()
        return Literal(value=token.value, raw=token.text)

    # -- names -----------------------------------------------------------

    def _parse_identifier(self, *, context: str) -> str:
        token = self.current
        if token.type in (TokenType.IDENTIFIER, TokenType.QUOTED_IDENTIFIER):
            self._advance()
            return str(token.value)
        if token.type is TokenType.KEYWORD and not is_reserved(str(token.value)):
            self._advance()
            return str(token.value).lower()
        raise self._error(f"expected {context}, found {token.describe()}")

    def _parse_object_name(self) -> str:
        name = self._parse_identifier(context="table name")
        while self.current.is_punctuation("."):
            self._advance()
            name = f"{name}.{self._parse_identifier(context='table name')}"
        return name

    # -- expressions -----------------------------------------------------

    def _parse_expression(self, min_precedence: int = 0) -> Expression:
        left = self._parse_postfix(self._parse_unary(), min_precedence)
        while True:
            operator = self._infix_operator(self.current)
            if operator is None:
                break
            precedence = _PRECEDENCE[operator]
            if precedence < min_precedence:
                break
            self._advance()
            right = self._parse_expression(precedence + 1)
            left = BinaryOp(op=operator, left=left, right=right)
            left = self._parse_postfix(left, min_precedence)
        return left

    def _infix_operator(self, token: Token) -> Optional[str]:
        if token.type is TokenType.OPERATOR and token.text in _PRECEDENCE:
            return token.text
        if token.type is TokenType.KEYWORD and str(token.value) in ("AND", "OR"):
            return str(token.value)
        return None

    def _parse_postfix(self, left: Expression, min_precedence: int) -> Expression:
        """Handle IS / IN / BETWEEN / LIKE which sit at comparison precedence."""

        while min_precedence <= _COMPARISON_LEVEL:
            token = self.current
            negated = False
            if token.is_keyword("NOT"):
                nxt = self._peek(1)
                if not nxt.is_keyword("IN", "BETWEEN", "LIKE"):
                    break
                self._advance()
                negated = True
                token = self.current
            if token.is_keyword("IS"):
                self._advance()
                is_negated = self._match_keyword("NOT")
                self._expect_keyword("NULL")
                left = IsNull(operand=left, negated=is_negated)
                continue
            if token.is_keyword("IN"):
                self._advance()
                left = self._parse_in_list(left, negated)
                continue
            if token.is_keyword("BETWEEN"):
                self._advance()
                low = self._parse_expression(_COMPARISON_LEVEL + 1)
                self._expect_keyword("AND")
                high = self._parse_expression(_COMPARISON_LEVEL + 1)
                left = Between(operand=left, low=low, high=high, negated=negated)
                continue
            if token.is_keyword("LIKE"):
                self._advance()
                pattern = self._parse_expression(_COMPARISON_LEVEL + 1)
                escape: Optional[Expression] = None
                if self._match_keyword("ESCAPE"):
                    escape = self._parse_expression(_COMPARISON_LEVEL + 1)
                left = LikeExpr(
                    operand=left, pattern=pattern, negated=negated, escape=escape
                )
                continue
            break
        return left

    def _parse_in_list(self, operand: Expression, negated: bool) -> Expression:
        self._expect_punctuation("(")
        if self.current.is_punctuation(")"):
            raise self._error("IN list must not be empty")
        items = [self._parse_expression()]
        while self._match_punctuation(","):
            items.append(self._parse_expression())
        self._expect_punctuation(")")
        return InList(operand=operand, items=tuple(items), negated=negated)

    def _parse_unary(self) -> Expression:
        token = self.current
        if token.is_keyword("NOT"):
            self._advance()
            return UnaryOp(op="NOT", operand=self._parse_expression(3))
        if token.is_operator("-", "+"):
            self._advance()
            operand = self._parse_expression(_UNARY_LEVEL)
            if token.text == "-" and isinstance(operand, Literal):
                if isinstance(operand.value, (int, float)) and not isinstance(
                    operand.value, bool
                ):
                    return Literal(value=-operand.value, raw=f"-{operand.raw or ''}")
            return UnaryOp(op=token.text, operand=operand)
        return self._parse_primary()

    def _parse_primary(self) -> Expression:
        token = self.current
        if token.is_punctuation("("):
            self._advance()
            inner = self._parse_expression()
            self._expect_punctuation(")")
            return inner
        if token.type is TokenType.NUMBER:
            self._advance()
            return Literal(value=token.value, raw=token.text)
        if token.type is TokenType.STRING:
            self._advance()
            return Literal(value=token.value, raw=token.text)
        if token.is_keyword("TRUE"):
            self._advance()
            return Literal(value=True, raw="TRUE")
        if token.is_keyword("FALSE"):
            self._advance()
            return Literal(value=False, raw="FALSE")
        if token.is_keyword("NULL"):
            self._advance()
            return Literal(value=None, raw="NULL")
        if token.is_keyword("CASE"):
            return self._parse_case()
        if token.is_keyword("CAST"):
            return self._parse_cast()
        if token.type in (TokenType.IDENTIFIER, TokenType.QUOTED_IDENTIFIER):
            return self._parse_identifier_expression()
        if token.type is TokenType.KEYWORD and not is_reserved(str(token.value)):
            return self._parse_identifier_expression()
        raise self._error(f"unexpected {token.describe()} in expression")

    def _parse_identifier_expression(self) -> Expression:
        first = str(self._advance().value)
        if self.current.is_punctuation("."):
            self._advance()
            second = self._parse_identifier(context="column name")
            return ColumnRef(name=second, qualifier=first)
        if self.current.is_punctuation("("):
            return self._parse_function_call(first)
        return ColumnRef(name=first)

    def _parse_function_call(self, name: str) -> Expression:
        self._expect_punctuation("(")
        if self.current.is_operator("*"):
            self._advance()
            self._expect_punctuation(")")
            return FunctionCall(name=name, args=(), star=True)
        distinct = self._match_keyword("DISTINCT")
        args: list[Expression] = []
        if not self.current.is_punctuation(")"):
            args.append(self._parse_expression())
            while self._match_punctuation(","):
                args.append(self._parse_expression())
        self._expect_punctuation(")")
        if distinct and not args:
            raise self._error("DISTINCT requires at least one argument")
        return FunctionCall(name=name, args=tuple(args), distinct=distinct)

    def _parse_cast(self) -> Expression:
        self._expect_keyword("CAST")
        self._expect_punctuation("(")
        operand = self._parse_expression()
        self._expect_keyword("AS")
        type_name = self._parse_type_name()
        self._expect_punctuation(")")
        return Cast(operand=operand, type_name=type_name)

    def _parse_type_name(self) -> str:
        token = self.current
        if token.type is TokenType.KEYWORD and str(token.value) in TYPE_KEYWORDS:
            self._advance()
            name = str(token.value).lower()
        elif token.type is TokenType.IDENTIFIER:
            self._advance()
            name = str(token.value)
        else:
            raise self._error(f"expected a type name, found {token.describe()}")
        if self.current.is_punctuation("("):
            # Accept and discard precision/length modifiers: VARCHAR(32).
            self._advance()
            while not self.current.is_punctuation(")"):
                if self.current.is_eof:
                    raise self._error("unterminated type modifier")
                self._advance()
            self._advance()
        return name

    def _parse_case(self) -> Expression:
        self._expect_keyword("CASE")
        operand: Optional[Expression] = None
        if not self.current.is_keyword("WHEN"):
            operand = self._parse_expression()
        whens: list[WhenClause] = []
        while self._match_keyword("WHEN"):
            condition = self._parse_expression()
            self._expect_keyword("THEN")
            result = self._parse_expression()
            whens.append(WhenClause(condition=condition, result=result))
        if not whens:
            raise self._error("CASE requires at least one WHEN branch")
        default: Optional[Expression] = None
        if self._match_keyword("ELSE"):
            default = self._parse_expression()
        self._expect_keyword("END")
        return CaseExpr(whens=tuple(whens), operand=operand, default=default)


def parse(source: str, *, fold_identifiers: bool = True) -> Statement:
    """Parse ``source`` into a single statement."""

    return Parser(source, fold_identifiers=fold_identifiers).parse_statement()


def parse_expression(source: str, *, fold_identifiers: bool = True) -> Expression:
    """Parse a bare SQL expression."""

    return Parser(source, fold_identifiers=fold_identifiers).parse_standalone_expression()


def parse_many(sources: Sequence[str]) -> list[Statement]:
    """Parse a batch of statements, useful for script files."""

    return [parse(text) for text in sources]


def _attach_trailing(
    statement: Statement,
    order_by: tuple[OrderByItem, ...],
    limit: Optional[Expression],
    offset: Optional[Expression],
) -> Statement:
    """Attach trailing sort/limit clauses to whichever statement kind we have."""

    if isinstance(statement, SelectStatement):
        return replace(statement, order_by=order_by, limit=limit, offset=offset)
    if isinstance(statement, SetOperation):
        return replace(statement, order_by=order_by, limit=limit, offset=offset)
    raise TypeError(f"cannot attach trailing clauses to {type(statement).__name__}")
