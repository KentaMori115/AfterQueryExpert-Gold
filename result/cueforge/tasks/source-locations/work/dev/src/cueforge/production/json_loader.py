"""JSON loader that captures numeric tokens as decimal text and node positions."""

from __future__ import annotations

import json
import re
from typing import Any

from cueforge.findings import SourceRef
from cueforge.production.source_map import NodePath, SourceMap

_NUMBER = re.compile(r"-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?")
_ESCAPES = {
    '"': '"',
    "\\": "\\",
    "/": "/",
    "b": "\b",
    "f": "\f",
    "n": "\n",
    "r": "\r",
    "t": "\t",
}
_WHITESPACE = " \t\n\r"


def parse_json_text(text: str) -> Any:
    return json.loads(text, parse_float=lambda token: token, parse_int=lambda token: token)


class _Scanner:
    """Recursive-descent JSON reader that remembers where each node started.

    It accepts what :func:`json.loads` accepts for a production document and
    yields the same values: numbers stay the text they were written as,
    duplicate keys let the last one win, strings decode their escapes.  Every
    node is recorded in a :class:`SourceMap` under its path, with the line
    and column of its first character.
    """

    def __init__(self, text: str, path: str, positions: SourceMap) -> None:
        self.text = text
        self.path = path
        self.positions = positions
        self.index = 0
        self.line = 1
        self.column = 1

    # -- low level -------------------------------------------------------

    def error(self, message: str) -> json.JSONDecodeError:
        return json.JSONDecodeError(message, self.text, self.index)

    def here(self) -> SourceRef:
        return SourceRef(path=self.path, line=self.line, column=self.column)

    def peek(self) -> str:
        return self.text[self.index] if self.index < len(self.text) else ""

    def advance(self, count: int = 1) -> None:
        for _ in range(count):
            if self.index >= len(self.text):
                return
            if self.text[self.index] == "\n":
                self.line += 1
                self.column = 1
            else:
                self.column += 1
            self.index += 1

    def skip_whitespace(self) -> None:
        while self.index < len(self.text) and self.text[self.index] in _WHITESPACE:
            self.advance()

    def expect(self, char: str, message: str) -> None:
        if self.peek() != char:
            raise self.error(message)
        self.advance()

    # -- grammar ---------------------------------------------------------

    def document(self) -> Any:
        value = self.value(())
        self.skip_whitespace()
        if self.index != len(self.text):
            raise self.error("Extra data")
        return value

    def value(self, node: NodePath) -> Any:
        self.skip_whitespace()
        char = self.peek()
        start = self.here()
        if char == "{":
            result: Any = self.mapping(node)
        elif char == "[":
            result = self.sequence(node)
        elif char == '"':
            result = self.string()
        elif char == "-" or char.isdigit():
            result = self.number()
        elif self.text.startswith("true", self.index):
            self.advance(4)
            result = True
        elif self.text.startswith("false", self.index):
            self.advance(5)
            result = False
        elif self.text.startswith("null", self.index):
            self.advance(4)
            result = None
        else:
            raise self.error("Expecting value")
        self.positions.add_value(node, start)
        return result

    def mapping(self, node: NodePath) -> dict[str, Any]:
        self.advance()  # {
        result: dict[str, Any] = {}
        self.skip_whitespace()
        if self.peek() == "}":
            self.advance()
            return result
        while True:
            self.skip_whitespace()
            if self.peek() != '"':
                raise self.error("Expecting property name enclosed in double quotes")
            key_start = self.here()
            key = self.string()
            self.skip_whitespace()
            self.expect(":", "Expecting ':' delimiter")
            child = (*node, key)
            result[key] = self.value(child)
            self.positions.add_key(child, key_start)
            self.skip_whitespace()
            if self.peek() == ",":
                self.advance()
                continue
            self.expect("}", "Expecting ',' delimiter")
            return result

    def sequence(self, node: NodePath) -> list[Any]:
        self.advance()  # [
        result: list[Any] = []
        self.skip_whitespace()
        if self.peek() == "]":
            self.advance()
            return result
        while True:
            result.append(self.value((*node, len(result))))
            self.skip_whitespace()
            if self.peek() == ",":
                self.advance()
                continue
            self.expect("]", "Expecting ',' delimiter")
            return result

    def string(self) -> str:
        self.advance()  # opening quote
        pieces: list[str] = []
        while True:
            char = self.peek()
            if char == "":
                raise self.error("Unterminated string starting at")
            if char == '"':
                self.advance()
                return "".join(pieces)
            if char == "\\":
                self.advance()
                escape = self.peek()
                if escape == "u":
                    pieces.append(self.unicode_escape())
                    continue
                if escape not in _ESCAPES:
                    raise self.error("Invalid \\escape")
                pieces.append(_ESCAPES[escape])
                self.advance()
                continue
            if ord(char) < 0x20:
                raise self.error("Invalid control character at")
            pieces.append(char)
            self.advance()

    def unicode_escape(self) -> str:
        code = self.hex4()
        if 0xD800 <= code <= 0xDBFF and self.text.startswith("\\u", self.index):
            self.advance(2)
            low = self.hex4()
            if 0xDC00 <= low <= 0xDFFF:
                code = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00)
                return chr(code)
            return chr(code) + chr(low)
        return chr(code)

    def hex4(self) -> int:
        self.advance()  # u
        digits = self.text[self.index : self.index + 4]
        if len(digits) != 4 or any(d not in "0123456789abcdefABCDEF" for d in digits):
            raise self.error("Invalid \\uXXXX escape")
        self.advance(4)
        return int(digits, 16)

    def number(self) -> str:
        match = _NUMBER.match(self.text, self.index)
        if match is None:
            raise self.error("Expecting value")
        token = match.group(0)
        self.advance(len(token))
        return token


def parse_json_with_positions(text: str, path: str) -> tuple[Any, SourceMap]:
    """Parse ``text`` like :func:`parse_json_text` and record every node's position."""
    positions = SourceMap()
    value = _Scanner(text, path, positions).document()
    return value, positions
