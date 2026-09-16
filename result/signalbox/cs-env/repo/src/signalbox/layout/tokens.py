"""Tokeniser for the scheme plan language.

The language is deliberately small: identifiers, numbers, quoted strings, a few
punctuation marks and significant newlines. Comments run from ``#`` to the end
of the line. Newlines matter because a declaration ends at one, which keeps the
grammar free of statement terminators that nobody wants to type.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from enum import Enum, auto

from ..errors import ParseError


class Kind(Enum):
    IDENT = auto()
    NUMBER = auto()
    STRING = auto()
    LBRACE = auto()
    RBRACE = auto()
    DOT = auto()
    COMMA = auto()
    COLON = auto()
    ARROW = auto()
    NEWLINE = auto()
    EOF = auto()


@dataclass(frozen=True)
class Token:
    kind: Kind
    text: str
    line: int
    column: int

    def __str__(self) -> str:
        if self.kind is Kind.NEWLINE:
            return "end of line"
        if self.kind is Kind.EOF:
            return "end of file"
        return repr(self.text)


_PUNCT = {
    "{": Kind.LBRACE,
    "}": Kind.RBRACE,
    ".": Kind.DOT,
    ",": Kind.COMMA,
    ":": Kind.COLON,
}

_IDENT_START = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_")
_IDENT_BODY = _IDENT_START | set("0123456789/-")
_DIGITS = set("0123456789")


class _Cursor:
    """Where the lexer has got to, and the only thing that moves it.

    Every scanner takes the cursor, consumes what it recognises and appends a
    token. Keeping the line and column arithmetic in one place is the point:
    getting it wrong is how an error ends up pointing at the wrong line, which
    is worse than no position at all.
    """

    def __init__(self, text: str, source: str) -> None:
        self.text = text
        self.source = source
        self.at = 0
        self.line = 1
        self.column = 1
        self.tokens: list[Token] = []

    @property
    def done(self) -> bool:
        return self.at >= len(self.text)

    @property
    def here(self) -> str:
        return self.text[self.at]

    def peek(self, ahead: int = 1) -> str:
        beyond = self.at + ahead
        return self.text[beyond] if beyond < len(self.text) else ""

    def take(self, count: int = 1) -> None:
        self.at += count
        self.column += count

    def newline(self) -> None:
        self.at += 1
        self.line += 1
        self.column = 1

    def emit(self, kind: Kind, raw: str, column: int) -> None:
        self.tokens.append(Token(kind, raw, self.line, column))

    def fail(self, message: str) -> ParseError:
        return ParseError(message, source=self.source, line=self.line)

    def eat_while(self, allowed: set[str]) -> None:
        while not self.done and self.here in allowed:
            self.take()

    def eat_number(self) -> None:
        """Digits, and at most one decimal point with digits after it."""
        self.eat_while(_DIGITS)
        if not self.done and self.here == "." and self.peek() in _DIGITS:
            self.take()
            self.eat_while(_DIGITS)


def _scan_newline(cursor: _Cursor) -> None:
    """Blank lines collapse, because a declaration ends at the first one."""
    if cursor.tokens and cursor.tokens[-1].kind is not Kind.NEWLINE:
        cursor.emit(Kind.NEWLINE, "\\n", cursor.column)
    cursor.newline()


def _scan_comment(cursor: _Cursor) -> None:
    while not cursor.done and cursor.here != "\n":
        cursor.at += 1


def _scan_arrow(cursor: _Cursor) -> None:
    cursor.emit(Kind.ARROW, "->", cursor.column)
    cursor.take(2)


def _scan_signed_number(cursor: _Cursor) -> None:
    """A falling gradient or a relative time: ``-220``, ``+10``."""
    start, column = cursor.at, cursor.column
    cursor.take()
    cursor.eat_number()
    cursor.emit(Kind.NUMBER, cursor.text[start : cursor.at], column)


def _scan_punctuation(cursor: _Cursor) -> None:
    cursor.emit(_PUNCT[cursor.here], cursor.here, cursor.column)
    cursor.take()


def _scan_string(cursor: _Cursor) -> None:
    column = cursor.column
    cursor.take()
    chars: list[str] = []

    while not cursor.done and cursor.here != '"':
        if cursor.here == "\n":
            raise cursor.fail("string runs past the end of the line")
        if cursor.here == "\\" and cursor.peek():
            chars.append(cursor.peek())
            cursor.take(2)
            continue
        chars.append(cursor.here)
        cursor.take()

    if cursor.done:
        raise cursor.fail("unterminated string")
    cursor.take()
    cursor.emit(Kind.STRING, "".join(chars), column)


def _scan_number_or_headcode(cursor: _Cursor) -> None:
    """A headcode such as 1A05 begins with a digit but is a name, not a number."""
    start, column = cursor.at, cursor.column
    cursor.eat_number()

    if not cursor.done and cursor.here in _IDENT_START:
        cursor.eat_while(_IDENT_BODY)
        cursor.emit(Kind.IDENT, cursor.text[start : cursor.at], column)
        return
    cursor.emit(Kind.NUMBER, cursor.text[start : cursor.at], column)


def _scan_identifier(cursor: _Cursor) -> None:
    start, column = cursor.at, cursor.column
    cursor.eat_while(_IDENT_BODY)
    cursor.emit(Kind.IDENT, cursor.text[start : cursor.at], column)


#: A scanner consumes whatever it recognises and appends the token for it.
Scanner = Callable[["_Cursor"], None]


def _next_scanner(cursor: _Cursor) -> Scanner | None:
    """Which scanner recognises what the cursor is looking at."""
    ch = cursor.here
    if ch == "\n":
        return _scan_newline
    if ch in " \t\r":
        return _Cursor.take
    if ch == "#":
        return _scan_comment
    if ch == "-" and cursor.peek() == ">":
        return _scan_arrow
    if ch in "+-" and cursor.peek() in _DIGITS:
        return _scan_signed_number
    if ch in _PUNCT:
        return _scan_punctuation
    if ch == '"':
        return _scan_string
    if ch in _DIGITS:
        return _scan_number_or_headcode
    if ch in _IDENT_START:
        return _scan_identifier
    return None


def tokenize(text: str, *, source: str = "<string>") -> list[Token]:
    """Turn scheme plan text into a token list ending with a single EOF."""
    cursor = _Cursor(text, source)

    while not cursor.done:
        scanner = _next_scanner(cursor)
        if scanner is None:
            raise cursor.fail(f"unexpected character {cursor.here!r}")
        scanner(cursor)

    tokens, line, column = cursor.tokens, cursor.line, cursor.column
    if tokens and tokens[-1].kind is not Kind.NEWLINE:
        tokens.append(Token(Kind.NEWLINE, "\\n", line, column))
    tokens.append(Token(Kind.EOF, "", line, column))
    return tokens
