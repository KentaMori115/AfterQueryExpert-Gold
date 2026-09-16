"""Precedence-climbing parser for the expression language.

The grammar, loosest binding first::

    or        := and (OR and)*
    and       := not (AND not)*
    not       := NOT not | predicate
    predicate := comparison (IS [NOT] NULL | [NOT] IN (...) | [NOT] BETWEEN a AND b | [NOT] LIKE x)*
    comparison:= concat ((= | <> | < | <= | > | >=) concat)*
    concat    := additive (|| additive)*
    additive  := multiplicative ((+ | -) multiplicative)*
    multiplicative := unary ((* | / | %) unary)*
    unary     := (- | +) unary | primary
    primary   := literal | column | function | CASE | CAST | ( or )

The parser is shared with the SQL statement parser, which calls
:meth:`ExpressionParser.parse_expression` at each point a value may appear.
"""

from __future__ import annotations

from typing import List, Optional, Sequence

from ..errors import ParseError, UnexpectedTokenError
from ..types.dtypes import DataType, parse_dtype
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
from .tokenizer import Token, TokenType, tokenize

__all__ = ["ExpressionParser", "parse_expression"]

# Names that must build an AggregateCall rather than a FunctionCall.
AGGREGATE_NAMES = frozenset(
    {
        "count",
        "sum",
        "avg",
        "mean",
        "min",
        "max",
        "stddev",
        "variance",
        "first",
        "last",
        "string_agg",
        "bool_and",
        "bool_or",
    }
)

_COMPARISONS = ("=", "!=", "<", "<=", ">", ">=")
_ADDITIVE = ("+", "-")
_MULTIPLICATIVE = ("*", "/", "%")


class ExpressionParser:
    """A cursor over a token list with one expression grammar attached."""

    def __init__(self, tokens: Sequence[Token], source: str = "") -> None:
        self.tokens = list(tokens)
        self.source = source
        self.position = 0

    # ------------------------------------------------------------------
    # Cursor helpers
    # ------------------------------------------------------------------
    @property
    def current(self) -> Token:
        """The token under the cursor."""
        return self.tokens[min(self.position, len(self.tokens) - 1)]

    def peek(self, offset: int = 1) -> Token:
        """Look ahead without consuming."""
        index = min(self.position + offset, len(self.tokens) - 1)
        return self.tokens[index]

    def advance(self) -> Token:
        """Consume and return the current token."""
        token = self.current
        if self.position < len(self.tokens) - 1:
            self.position += 1
        return token

    def at_end(self) -> bool:
        """True when the cursor sits on the synthetic ``END`` token."""
        return self.current.is_end()

    def match_keyword(self, *names: str) -> bool:
        """Consume the current token when it is one of ``names``."""
        if self.current.is_keyword(*names):
            self.advance()
            return True
        return False

    def match_punctuation(self, *symbols: str) -> bool:
        """Consume the current token when it is one of ``symbols``."""
        if self.current.is_punctuation(*symbols):
            self.advance()
            return True
        return False

    def match_operator(self, *symbols: str) -> bool:
        """Consume the current token when it is one of ``symbols``."""
        if self.current.is_operator(*symbols):
            self.advance()
            return True
        return False

    def expect_keyword(self, *names: str) -> Token:
        """Consume a required keyword.

        Raises:
            UnexpectedTokenError: If the current token is something else.
        """
        if not self.current.is_keyword(*names):
            raise self._unexpected(list(names))
        return self.advance()

    def expect_punctuation(self, symbol: str) -> Token:
        """Consume a required punctuation mark."""
        if not self.current.is_punctuation(symbol):
            raise self._unexpected([symbol])
        return self.advance()

    def expect_identifier(self) -> str:
        """Consume an identifier, accepting the quoted form."""
        token = self.current
        if token.type is TokenType.IDENTIFIER:
            self.advance()
            return token.text
        if token.type is TokenType.QUOTED_IDENTIFIER:
            self.advance()
            return token.text
        raise self._unexpected(["identifier"])

    # ------------------------------------------------------------------
    # Grammar
    # ------------------------------------------------------------------
    def parse_expression(self) -> Expression:
        """Parse one complete expression at the cursor."""
        return self._parse_or()

    def parse_aliased_expression(self) -> Expression:
        """Parse an expression followed by an optional ``AS`` alias."""
        expression = self.parse_expression()
        if self.match_keyword("as"):
            return Alias(expression, self.expect_identifier())
        token = self.current
        if token.type in (TokenType.IDENTIFIER, TokenType.QUOTED_IDENTIFIER):
            self.advance()
            return Alias(expression, token.text)
        return expression

    def _parse_or(self) -> Expression:
        left = self._parse_and()
        while self.match_keyword("or"):
            left = BinaryOp("or", left, self._parse_and())
        return left

    def _parse_and(self) -> Expression:
        left = self._parse_not()
        while self.match_keyword("and"):
            left = BinaryOp("and", left, self._parse_not())
        return left

    def _parse_not(self) -> Expression:
        if self.match_keyword("not"):
            return UnaryOp("not", self._parse_not())
        return self._parse_predicate()

    def _parse_predicate(self) -> Expression:
        expression = self._parse_comparison()
        while True:
            if self.current.is_keyword("is"):
                self.advance()
                negated = self.match_keyword("not")
                self.expect_keyword("null")
                expression = IsNull(expression, negated)
                continue
            negated = False
            checkpoint = self.position
            if self.current.is_keyword("not"):
                self.advance()
                negated = True
            if self.current.is_keyword("in"):
                self.advance()
                expression = self._parse_in_list(expression, negated)
                continue
            if self.current.is_keyword("between"):
                self.advance()
                low = self._parse_concat()
                self.expect_keyword("and")
                high = self._parse_concat()
                expression = Between(expression, low, high, negated)
                continue
            if self.current.is_keyword("like"):
                self.advance()
                pattern = self._parse_concat()
                operator = "not like" if negated else "like"
                expression = BinaryOp(operator, expression, pattern)
                continue
            self.position = checkpoint
            return expression

    def _parse_in_list(self, child: Expression, negated: bool) -> Expression:
        self.expect_punctuation("(")
        options: List[Expression] = []
        if not self.current.is_punctuation(")"):
            options.append(self.parse_expression())
            while self.match_punctuation(","):
                options.append(self.parse_expression())
        self.expect_punctuation(")")
        if not options:
            raise ParseError(
                "IN requires at least one value",
                position=self.current.position,
                line=self.current.line,
                column=self.current.column,
                source=self.source,
            )
        return InList(child, tuple(options), negated)

    def _parse_comparison(self) -> Expression:
        left = self._parse_concat()
        while self.current.is_operator(*_COMPARISONS):
            operator = self.advance().text
            left = BinaryOp(operator, left, self._parse_concat())
        return left

    def _parse_concat(self) -> Expression:
        left = self._parse_additive()
        while self.match_operator("||"):
            left = BinaryOp("||", left, self._parse_additive())
        return left

    def _parse_additive(self) -> Expression:
        left = self._parse_multiplicative()
        while self.current.is_operator(*_ADDITIVE):
            operator = self.advance().text
            left = BinaryOp(operator, left, self._parse_multiplicative())
        return left

    def _parse_multiplicative(self) -> Expression:
        left = self._parse_unary()
        while self.current.is_operator(*_MULTIPLICATIVE):
            operator = self.advance().text
            left = BinaryOp(operator, left, self._parse_unary())
        return left

    def _parse_unary(self) -> Expression:
        if self.current.is_operator("-"):
            self.advance()
            return UnaryOp("-", self._parse_unary())
        if self.current.is_operator("+"):
            self.advance()
            return self._parse_unary()
        return self._parse_primary()

    def _parse_primary(self) -> Expression:
        token = self.current
        if token.is_punctuation("("):
            self.advance()
            inner = self.parse_expression()
            self.expect_punctuation(")")
            return inner
        if token.type is TokenType.NUMBER:
            self.advance()
            return _number_literal(token.text)
        if token.type is TokenType.STRING:
            self.advance()
            return Literal(token.text, DataType.STRING)
        if token.is_keyword("true", "false"):
            self.advance()
            return Literal(token.text.lower() == "true", DataType.BOOL)
        if token.is_keyword("null"):
            self.advance()
            return Literal(None, DataType.NULL)
        if token.is_keyword("case"):
            return self._parse_case()
        if token.is_keyword("cast"):
            return self._parse_cast()
        if token.type in (TokenType.IDENTIFIER, TokenType.QUOTED_IDENTIFIER):
            return self._parse_identifier_expression()
        raise self._unexpected(["expression"])

    def _parse_identifier_expression(self) -> Expression:
        token = self.advance()
        name = token.text
        if self.current.is_punctuation("("):
            return self._parse_call(name)
        qualifier: Optional[str] = None
        if self.current.is_punctuation("."):
            self.advance()
            if self.current.is_operator("*"):
                self.advance()
                return ColumnRef("*", name)
            qualifier = name
            name = self.expect_identifier()
        return ColumnRef(name, qualifier)

    def _parse_call(self, name: str) -> Expression:
        self.expect_punctuation("(")
        lowered = name.lower()
        distinct = False
        args: List[Expression] = []
        if self.current.is_operator("*") and lowered == "count":
            self.advance()
            self.expect_punctuation(")")
            return AggregateCall("count", (), False)
        if self.match_keyword("distinct"):
            distinct = True
        if not self.current.is_punctuation(")"):
            args.append(self.parse_expression())
            while self.match_punctuation(","):
                args.append(self.parse_expression())
        self.expect_punctuation(")")
        canonical = "avg" if lowered == "mean" else lowered
        if _is_aggregate(canonical):
            return AggregateCall(canonical, tuple(args), distinct)
        if distinct:
            raise ParseError(
                f"DISTINCT is only valid inside an aggregate, not {name}()",
                position=self.current.position,
                line=self.current.line,
                column=self.current.column,
                source=self.source,
            )
        return FunctionCall(lowered, tuple(args))

    def _parse_case(self) -> Expression:
        self.expect_keyword("case")
        operand: Optional[Expression] = None
        if not self.current.is_keyword("when"):
            operand = self.parse_expression()
        branches: List[tuple] = []
        while self.match_keyword("when"):
            condition = self.parse_expression()
            if operand is not None:
                condition = BinaryOp("=", operand, condition)
            self.expect_keyword("then")
            branches.append((condition, self.parse_expression()))
        otherwise: Optional[Expression] = None
        if self.match_keyword("else"):
            otherwise = self.parse_expression()
        self.expect_keyword("end")
        if not branches:
            raise ParseError(
                "CASE requires at least one WHEN branch",
                position=self.current.position,
                line=self.current.line,
                column=self.current.column,
                source=self.source,
            )
        return CaseWhen(tuple(branches), otherwise)

    def _parse_cast(self) -> Expression:
        self.expect_keyword("cast")
        self.expect_punctuation("(")
        value = self.parse_expression()
        self.expect_keyword("as")
        type_token = self.current
        if type_token.type not in (TokenType.IDENTIFIER, TokenType.KEYWORD):
            raise self._unexpected(["type name"])
        self.advance()
        try:
            target = parse_dtype(type_token.text)
        except ValueError as error:
            raise ParseError(
                str(error),
                position=type_token.position,
                line=type_token.line,
                column=type_token.column,
                source=self.source,
            ) from None
        self.expect_punctuation(")")
        return Cast(value, target)

    # ------------------------------------------------------------------
    # Errors
    # ------------------------------------------------------------------
    def _unexpected(self, expected: Sequence[str]) -> UnexpectedTokenError:
        token = self.current
        return UnexpectedTokenError(
            str(token),
            expected,
            position=token.position,
            line=token.line,
            column=token.column,
            source=self.source,
        )


def _is_aggregate(name: str) -> bool:
    """True when a call should become an aggregate rather than a function.

    An engine that has registered its own aggregates publishes its registry
    while planning; outside that, the built-in names are the whole story.
    """
    from .resolver import current_aggregates

    registry = current_aggregates()
    if registry is not None:
        return registry.has(name)
    return name in AGGREGATE_NAMES


def _number_literal(text: str) -> Literal:
    """Build an integer or floating point literal from its text."""
    if any(char in text for char in ".eE"):
        return Literal(float(text), DataType.FLOAT64)
    return Literal(int(text), DataType.INT64)


def parse_expression(source: str) -> Expression:
    """Parse a standalone expression.

    Raises:
        ParseError: On malformed input or trailing tokens.
    """
    parser = ExpressionParser(tokenize(source), source)
    expression = parser.parse_expression()
    if not parser.at_end():
        raise parser._unexpected(["end of input"])
    return expression
