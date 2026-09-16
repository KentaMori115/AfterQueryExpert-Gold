"""Token definitions produced by :mod:`slateql.sql.lexer`."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any, Optional

__all__ = ["TokenType", "Token", "OPERATOR_CHARS", "MULTI_CHAR_OPERATORS"]


class TokenType(Enum):
    IDENTIFIER = "identifier"
    QUOTED_IDENTIFIER = "quoted-identifier"
    KEYWORD = "keyword"
    NUMBER = "number"
    STRING = "string"
    OPERATOR = "operator"
    PUNCTUATION = "punctuation"
    EOF = "end-of-input"

    def __str__(self) -> str:  # pragma: no cover - trivial
        return self.value


OPERATOR_CHARS = frozenset("+-*/%<>=!|")

MULTI_CHAR_OPERATORS = ("<>", "!=", "<=", ">=", "||")


@dataclass(frozen=True)
class Token:
    """A single lexical unit with its source position.

    ``text`` is the raw slice from the query while ``value`` holds the decoded
    payload: an ``int``/``float`` for numbers, the unescaped contents for
    strings and quoted identifiers, and the upper-cased word for keywords.
    """

    type: TokenType
    text: str
    value: Any
    position: int
    line: int
    column: int

    @property
    def is_eof(self) -> bool:
        return self.type is TokenType.EOF

    def is_keyword(self, *words: str) -> bool:
        """Whether this token is one of the given keywords."""

        return self.type is TokenType.KEYWORD and self.value in {
            word.upper() for word in words
        }

    def is_punctuation(self, *symbols: str) -> bool:
        return self.type is TokenType.PUNCTUATION and self.text in symbols

    def is_operator(self, *symbols: str) -> bool:
        return self.type is TokenType.OPERATOR and self.text in symbols

    def describe(self) -> str:
        """Human readable description used in parser error messages."""

        if self.type is TokenType.EOF:
            return "end of input"
        if self.type is TokenType.STRING:
            return f"string literal {self.text}"
        if self.type is TokenType.NUMBER:
            return f"number {self.text}"
        if self.type is TokenType.KEYWORD:
            return f"keyword {self.value}"
        return f"{self.text!r}"

    def __str__(self) -> str:  # pragma: no cover - debugging aid
        return f"{self.type}({self.text!r})@{self.line}:{self.column}"


def eof_token(position: int, line: int, column: int) -> Token:
    """Construct the sentinel token that terminates every token stream."""

    return Token(TokenType.EOF, "", None, position, line, column)


def make_identifier(
    text: str, value: str, position: int, line: int, column: int, *, quoted: bool = False
) -> Token:
    kind = TokenType.QUOTED_IDENTIFIER if quoted else TokenType.IDENTIFIER
    return Token(kind, text, value, position, line, column)


def token_summary(tokens: list[Token], limit: Optional[int] = None) -> str:
    """Compact rendering of a token list, used when debugging the lexer."""

    shown = tokens if limit is None else tokens[:limit]
    return " ".join(token.text or "<eof>" for token in shown)
