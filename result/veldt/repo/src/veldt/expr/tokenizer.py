"""Lexical analysis for expressions and SQL statements.

One tokenizer serves both surfaces. It knows about SQL string literals with
doubled-quote escapes, double-quoted identifiers, line and block comments,
numeric literals with exponents, and the multi-character operators the parser
needs to see as single tokens.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import List, Optional, Sequence, Set

from ..errors import ParseError

__all__ = ["TokenType", "Token", "Tokenizer", "tokenize"]

# Longest first: the scanner tries these in order so that ``<=`` never lexes as
# ``<`` followed by ``=``.
_OPERATORS = (
    "<>",
    "!=",
    "<=",
    ">=",
    "||",
    "=",
    "<",
    ">",
    "+",
    "-",
    "*",
    "/",
    "%",
)

_PUNCTUATION = frozenset({"(", ")", ",", ".", ";"})

_KEYWORDS: Set[str] = {
    "all",
    "and",
    "as",
    "asc",
    "between",
    "by",
    "case",
    "cast",
    "cross",
    "desc",
    "distinct",
    "else",
    "end",
    "false",
    "first",
    "from",
    "full",
    "group",
    "having",
    "in",
    "inner",
    "is",
    "join",
    "last",
    "left",
    "like",
    "limit",
    "not",
    "null",
    "nulls",
    "offset",
    "on",
    "or",
    "order",
    "outer",
    "right",
    "select",
    "then",
    "true",
    "union",
    "using",
    "when",
    "where",
}


class TokenType(Enum):
    """The kinds of token the scanner produces."""

    IDENTIFIER = "identifier"
    QUOTED_IDENTIFIER = "quoted_identifier"
    KEYWORD = "keyword"
    NUMBER = "number"
    STRING = "string"
    OPERATOR = "operator"
    PUNCTUATION = "punctuation"
    END = "end"


@dataclass(frozen=True)
class Token:
    """A single lexical token with its source position."""

    type: TokenType
    text: str
    position: int
    line: int
    column: int

    @property
    def normalized(self) -> str:
        """Keywords and bare identifiers lowered; other text left alone."""
        if self.type in (TokenType.KEYWORD, TokenType.IDENTIFIER, TokenType.OPERATOR):
            return self.text.lower()
        return self.text

    def is_keyword(self, *names: str) -> bool:
        """True when this token is one of the named keywords."""
        return self.type is TokenType.KEYWORD and self.text.lower() in names

    def is_punctuation(self, *symbols: str) -> bool:
        """True when this token is one of the given punctuation marks."""
        return self.type is TokenType.PUNCTUATION and self.text in symbols

    def is_operator(self, *symbols: str) -> bool:
        """True when this token is one of the given operators."""
        return self.type is TokenType.OPERATOR and self.text.lower() in symbols

    def is_end(self) -> bool:
        """True for the synthetic end-of-input token."""
        return self.type is TokenType.END

    def __str__(self) -> str:
        return self.text if self.text else "<end of input>"


class Tokenizer:
    """Turns source text into a list of :class:`Token` objects."""

    def __init__(self, source: str) -> None:
        self.source = source
        self._position = 0
        self._line = 1
        self._column = 1

    def tokenize(self) -> List[Token]:
        """Scan the whole input.

        Raises:
            ParseError: On an unterminated string, identifier or comment, or an
                unrecognised character.
        """
        tokens: List[Token] = []
        while True:
            self._skip_whitespace_and_comments()
            if self._position >= len(self.source):
                break
            tokens.append(self._scan_token())
        tokens.append(Token(TokenType.END, "", self._position, self._line, self._column))
        return tokens

    # ------------------------------------------------------------------
    # Scanning
    # ------------------------------------------------------------------
    def _scan_token(self) -> Token:
        char = self.source[self._position]
        if char == "'":
            return self._scan_string()
        if char == '"':
            return self._scan_quoted_identifier()
        if char.isdigit() or (char == "." and self._peek_is_digit(1)):
            return self._scan_number()
        if char.isalpha() or char == "_":
            return self._scan_word()
        operator = self._match_operator()
        if operator is not None:
            return operator
        if char in _PUNCTUATION:
            return self._emit(TokenType.PUNCTUATION, char, 1)
        raise self._error(f"unexpected character {char!r}")

    def _scan_string(self) -> Token:
        start, line, column = self._position, self._line, self._column
        index = self._position + 1
        pieces: List[str] = []
        while index < len(self.source):
            char = self.source[index]
            if char == "'":
                if index + 1 < len(self.source) and self.source[index + 1] == "'":
                    pieces.append("'")
                    index += 2
                    continue
                self._advance_to(index + 1)
                return Token(TokenType.STRING, "".join(pieces), start, line, column)
            pieces.append(char)
            index += 1
        raise self._error("unterminated string literal")

    def _scan_quoted_identifier(self) -> Token:
        start, line, column = self._position, self._line, self._column
        index = self._position + 1
        pieces: List[str] = []
        while index < len(self.source):
            char = self.source[index]
            if char == '"':
                if index + 1 < len(self.source) and self.source[index + 1] == '"':
                    pieces.append('"')
                    index += 2
                    continue
                self._advance_to(index + 1)
                text = "".join(pieces)
                if not text:
                    raise self._error("empty quoted identifier")
                return Token(TokenType.QUOTED_IDENTIFIER, text, start, line, column)
            pieces.append(char)
            index += 1
        raise self._error("unterminated quoted identifier")

    def _scan_number(self) -> Token:
        start, line, column = self._position, self._line, self._column
        index = self._position
        seen_dot = False
        seen_exponent = False
        while index < len(self.source):
            char = self.source[index]
            if char.isdigit():
                index += 1
                continue
            if char == "." and not seen_dot and not seen_exponent:
                seen_dot = True
                index += 1
                continue
            if char in "eE" and not seen_exponent and index > start:
                lookahead = index + 1
                if lookahead < len(self.source) and self.source[lookahead] in "+-":
                    lookahead += 1
                if lookahead < len(self.source) and self.source[lookahead].isdigit():
                    seen_exponent = True
                    index = lookahead
                    continue
            break
        text = self.source[start:index]
        self._advance_to(index)
        return Token(TokenType.NUMBER, text, start, line, column)

    def _scan_word(self) -> Token:
        start, line, column = self._position, self._line, self._column
        index = self._position
        while index < len(self.source):
            char = self.source[index]
            if char.isalnum() or char == "_":
                index += 1
                continue
            break
        text = self.source[start:index]
        self._advance_to(index)
        kind = TokenType.KEYWORD if text.lower() in _KEYWORDS else TokenType.IDENTIFIER
        return Token(kind, text, start, line, column)

    def _match_operator(self) -> Optional[Token]:
        for symbol in _OPERATORS:
            if self.source.startswith(symbol, self._position):
                text = "!=" if symbol == "<>" else symbol
                return self._emit(TokenType.OPERATOR, text, len(symbol))
        return None

    # ------------------------------------------------------------------
    # Position bookkeeping
    # ------------------------------------------------------------------
    def _skip_whitespace_and_comments(self) -> None:
        while self._position < len(self.source):
            char = self.source[self._position]
            if char in " \t\r\n":
                self._advance_to(self._position + 1)
                continue
            if self.source.startswith("--", self._position):
                end = self.source.find("\n", self._position)
                self._advance_to(len(self.source) if end == -1 else end)
                continue
            if self.source.startswith("/*", self._position):
                end = self.source.find("*/", self._position + 2)
                if end == -1:
                    raise self._error("unterminated block comment")
                self._advance_to(end + 2)
                continue
            return

    def _advance_to(self, index: int) -> None:
        """Move the cursor forward, tracking line and column numbers."""
        while self._position < index and self._position < len(self.source):
            if self.source[self._position] == "\n":
                self._line += 1
                self._column = 1
            else:
                self._column += 1
            self._position += 1

    def _peek_is_digit(self, offset: int) -> bool:
        index = self._position + offset
        return index < len(self.source) and self.source[index].isdigit()

    def _emit(self, kind: TokenType, text: str, length: int) -> Token:
        start, line, column = self._position, self._line, self._column
        self._advance_to(self._position + length)
        return Token(kind, text, start, line, column)

    def _error(self, message: str) -> ParseError:
        return ParseError(
            message,
            position=self._position,
            line=self._line,
            column=self._column,
            source=self.source,
        )


def tokenize(source: str) -> List[Token]:
    """Scan ``source`` into a token list ending with an ``END`` token."""
    return Tokenizer(source).tokenize()


def keywords() -> Sequence[str]:
    """Return the reserved words the tokenizer recognises."""
    return sorted(_KEYWORDS)
