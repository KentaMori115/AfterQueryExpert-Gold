"""Hand-written lexer for the SlateQL dialect.

The lexer is a straightforward character scanner.  It tracks line and column
positions for every token so that parser errors can point directly at the
offending text, and it never raises for a merely unexpected token -- only for
input it genuinely cannot turn into a token (an unterminated string, an
unterminated block comment, a stray character).
"""

from __future__ import annotations

from typing import Iterator, Optional

from ..errors import LexError
from .keywords import KEYWORDS
from .tokens import (
    MULTI_CHAR_OPERATORS,
    OPERATOR_CHARS,
    Token,
    TokenType,
    eof_token,
)

__all__ = ["Lexer", "tokenize"]

_PUNCTUATION = frozenset("(),.;")
_IDENT_START = frozenset("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_")
_IDENT_REST = _IDENT_START | frozenset("0123456789")
_DIGITS = frozenset("0123456789")
_WHITESPACE = frozenset(" \t\r\n\f\v")


class Lexer:
    """Turns query text into a list of :class:`Token` objects."""

    def __init__(self, source: str, *, fold_identifiers: bool = True) -> None:
        self.source = source
        self.fold_identifiers = fold_identifiers
        self._pos = 0
        self._line = 1
        self._col = 1

    # -- scanning primitives --------------------------------------------

    def _peek(self, offset: int = 0) -> str:
        index = self._pos + offset
        if index >= len(self.source):
            return ""
        return self.source[index]

    def _advance(self, count: int = 1) -> str:
        chunk = self.source[self._pos : self._pos + count]
        for ch in chunk:
            if ch == "\n":
                self._line += 1
                self._col = 1
            else:
                self._col += 1
        self._pos += count
        return chunk

    def _error(self, message: str, *, hint: Optional[str] = None) -> LexError:
        return LexError(
            message,
            position=self._pos,
            line=self._line,
            column=self._col,
            hint=hint,
        )

    # -- public API ------------------------------------------------------

    def tokens(self) -> list[Token]:
        """Scan the whole input and return every token including EOF."""

        return list(self)

    def __iter__(self) -> Iterator[Token]:
        while True:
            self._skip_trivia()
            if self._pos >= len(self.source):
                yield eof_token(self._pos, self._line, self._col)
                return
            yield self._scan_token()

    # -- individual scanners --------------------------------------------

    def _skip_trivia(self) -> None:
        """Consume whitespace plus ``--`` line and ``/* */`` block comments."""

        while self._pos < len(self.source):
            ch = self._peek()
            if ch in _WHITESPACE:
                self._advance()
                continue
            if ch == "-" and self._peek(1) == "-":
                while self._pos < len(self.source) and self._peek() != "\n":
                    self._advance()
                continue
            if ch == "/" and self._peek(1) == "*":
                self._skip_block_comment()
                continue
            return

    def _skip_block_comment(self) -> None:
        start_line, start_col = self._line, self._col
        self._advance(2)
        depth = 1
        while depth > 0:
            if self._pos >= len(self.source):
                raise LexError(
                    "unterminated block comment",
                    position=self._pos,
                    line=start_line,
                    column=start_col,
                )
            if self._peek() == "/" and self._peek(1) == "*":
                depth += 1
                self._advance(2)
            elif self._peek() == "*" and self._peek(1) == "/":
                depth -= 1
                self._advance(2)
            else:
                self._advance()

    def _scan_token(self) -> Token:
        start_pos, start_line, start_col = self._pos, self._line, self._col
        ch = self._peek()

        if ch in _IDENT_START:
            return self._scan_word(start_pos, start_line, start_col)
        if ch in _DIGITS or (ch == "." and self._peek(1) in _DIGITS):
            return self._scan_number(start_pos, start_line, start_col)
        if ch == "'":
            return self._scan_string(start_pos, start_line, start_col)
        if ch == '"':
            return self._scan_quoted_identifier(start_pos, start_line, start_col)
        if ch in _PUNCTUATION:
            self._advance()
            return Token(
                TokenType.PUNCTUATION, ch, ch, start_pos, start_line, start_col
            )
        if ch in OPERATOR_CHARS:
            return self._scan_operator(start_pos, start_line, start_col)
        raise self._error(f"unexpected character {ch!r}")

    def _scan_word(self, pos: int, line: int, col: int) -> Token:
        while self._peek() in _IDENT_REST and self._peek():
            self._advance()
        text = self.source[pos : self._pos]
        upper = text.upper()
        if upper in KEYWORDS:
            return Token(TokenType.KEYWORD, text, upper, pos, line, col)
        value = text.lower() if self.fold_identifiers else text
        return Token(TokenType.IDENTIFIER, text, value, pos, line, col)

    def _scan_number(self, pos: int, line: int, col: int) -> Token:
        seen_dot = False
        seen_exp = False
        while True:
            ch = self._peek()
            if ch in _DIGITS:
                self._advance()
            elif ch == "." and not seen_dot and not seen_exp:
                seen_dot = True
                self._advance()
            elif ch in ("e", "E") and not seen_exp and self._pos > pos:
                nxt = self._peek(1)
                if nxt in _DIGITS or (nxt in "+-" and self._peek(2) in _DIGITS):
                    seen_exp = True
                    self._advance(2 if nxt in "+-" else 1)
                else:
                    break
            else:
                break
        text = self.source[pos : self._pos]
        if self._peek() in _IDENT_START:
            raise self._error(f"invalid number literal near {text!r}")
        value: object
        if seen_dot or seen_exp:
            value = float(text)
        else:
            value = int(text)
        return Token(TokenType.NUMBER, text, value, pos, line, col)

    def _scan_string(self, pos: int, line: int, col: int) -> Token:
        self._advance()  # opening quote
        chunks: list[str] = []
        while True:
            if self._pos >= len(self.source):
                raise LexError(
                    "unterminated string literal",
                    position=pos,
                    line=line,
                    column=col,
                )
            ch = self._peek()
            if ch == "'":
                if self._peek(1) == "'":
                    chunks.append("'")
                    self._advance(2)
                    continue
                self._advance()
                break
            chunks.append(ch)
            self._advance()
        text = self.source[pos : self._pos]
        return Token(TokenType.STRING, text, "".join(chunks), pos, line, col)

    def _scan_quoted_identifier(self, pos: int, line: int, col: int) -> Token:
        self._advance()
        chunks: list[str] = []
        while True:
            if self._pos >= len(self.source):
                raise LexError(
                    "unterminated quoted identifier",
                    position=pos,
                    line=line,
                    column=col,
                )
            ch = self._peek()
            if ch == '"':
                if self._peek(1) == '"':
                    chunks.append('"')
                    self._advance(2)
                    continue
                self._advance()
                break
            chunks.append(ch)
            self._advance()
        name = "".join(chunks)
        if not name:
            raise LexError(
                "quoted identifier must not be empty",
                position=pos,
                line=line,
                column=col,
            )
        text = self.source[pos : self._pos]
        return Token(TokenType.QUOTED_IDENTIFIER, text, name, pos, line, col)

    def _scan_operator(self, pos: int, line: int, col: int) -> Token:
        two = self.source[self._pos : self._pos + 2]
        if two in MULTI_CHAR_OPERATORS:
            self._advance(2)
            return Token(TokenType.OPERATOR, two, two, pos, line, col)
        ch = self._peek()
        if ch == "!":
            raise self._error("unexpected '!'", hint="did you mean '!=' ?")
        if ch == "|":
            raise self._error("unexpected '|'", hint="string concatenation is '||'")
        self._advance()
        return Token(TokenType.OPERATOR, ch, ch, pos, line, col)


def tokenize(source: str, *, fold_identifiers: bool = True) -> list[Token]:
    """Convenience wrapper returning every token for ``source``."""

    return Lexer(source, fold_identifiers=fold_identifiers).tokens()
