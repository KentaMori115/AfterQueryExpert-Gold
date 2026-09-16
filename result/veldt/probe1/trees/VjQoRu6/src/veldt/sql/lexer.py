"""Statement-level lexing helpers.

Expressions and statements share one tokenizer; this module adds the two things
only statements need: splitting a script into individual statements, and
stripping the trailing semicolon.
"""

from __future__ import annotations

from typing import List, Sequence

from ..errors import ParseError
from ..expr.tokenizer import Token, TokenType, tokenize

__all__ = ["lex", "split_statements", "strip_terminator", "describe_tokens"]


def lex(source: str) -> List[Token]:
    """Tokenize a statement, raising on empty input.

    Raises:
        ParseError: If the text contains nothing but whitespace or comments.
    """
    tokens = tokenize(source)
    if len(tokens) == 1 and tokens[0].is_end():
        raise ParseError("empty statement", source=source)
    return tokens


def strip_terminator(tokens: Sequence[Token]) -> List[Token]:
    """Drop a trailing semicolon, keeping the end-of-input token."""
    items = list(tokens)
    if len(items) >= 2 and items[-2].is_punctuation(";"):
        del items[-2]
    return items


def split_statements(source: str) -> List[str]:
    """Split a script into statement texts on top-level semicolons.

    Semicolons inside string literals, quoted identifiers and comments are not
    separators, so the split runs over tokens rather than raw text.
    """
    tokens = tokenize(source)
    statements: List[str] = []
    start = 0
    for token in tokens:
        if token.is_punctuation(";"):
            text = source[start : token.position].strip()
            if text:
                statements.append(text)
            start = token.position + 1
    tail = source[start:].strip()
    if tail:
        statements.append(tail)
    return statements


def describe_tokens(tokens: Sequence[Token], limit: int = 12) -> str:
    """Render a token list for debugging and error messages."""
    rendered = [
        f"{token.type.value}:{token.text}" for token in tokens[:limit] if not token.is_end()
    ]
    if len(tokens) > limit:
        rendered.append("...")
    return " ".join(rendered)
