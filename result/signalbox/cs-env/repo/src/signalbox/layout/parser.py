"""Recursive descent parser for the scheme plan language.

A plan is a flat list of declarations. Order does not matter to the meaning, so
the parser never resolves references; it only records what was written and where
it was written, and leaves the cross checking to ``layout.validate``.

    scheme kingsmoor {
        area "Kingsmoor Junction"
        prefix K
    }

    node A boundary
    node P105 points
    node B buffer

    edge E1 from A to P105.toe length 420 speed 75 gradient 1 in 330
    edge E2 from P105.normal to B length 180 speed 15

    section TA over E1
    signal K12 on E1 at 380 facing forward aspects 4
    crossing LC21 on E1 at 120 type mcb strike_in 27
"""

from __future__ import annotations

from ..errors import ParseError
from .ast import (
    TRAFFIC_DIRECTIONS,
    CrossingDecl,
    CrossingKind,
    EdgeDecl,
    EndRef,
    Facing,
    NodeDecl,
    NodeKind,
    SchemeDecl,
    SectionDecl,
    SectionKind,
    SignalDecl,
    TrapDecl,
)
from .tokens import Kind, Token, tokenize

_EDGE_KEYWORDS = {"length", "speed", "gradient"}
_SIGNAL_KEYWORDS = {"aspects", "type", "class"}


class Parser:
    """Consumes a token list and builds a :class:`SchemeDecl`."""

    def __init__(self, tokens: list[Token], source: str = "<string>") -> None:
        self.tokens = tokens
        self.source = source
        self.pos = 0
        self.scheme = SchemeDecl(source=source)

    # token handling ----------------------------------------------------

    @property
    def current(self) -> Token:
        return self.tokens[self.pos]

    def advance(self) -> Token:
        token = self.tokens[self.pos]
        if token.kind is not Kind.EOF:
            self.pos += 1
        return token

    def at(self, kind: Kind, text: str | None = None) -> bool:
        token = self.current
        if token.kind is not kind:
            return False
        return text is None or token.text == text

    def accept(self, kind: Kind, text: str | None = None) -> Token | None:
        if self.at(kind, text):
            return self.advance()
        return None

    def expect(self, kind: Kind, text: str | None = None) -> Token:
        if self.at(kind, text):
            return self.advance()
        wanted = text if text is not None else kind.name.lower()
        raise self.error(f"expected {wanted}, found {self.current}")

    def error(self, message: str) -> ParseError:
        return ParseError(message, source=self.source, line=self.current.line)

    def ident(self) -> str:
        return self.expect(Kind.IDENT).text

    def number(self) -> float:
        return float(self.expect(Kind.NUMBER).text)

    def word_or_string(self) -> str:
        token = self.current
        if token.kind in (Kind.IDENT, Kind.STRING, Kind.NUMBER):
            return self.advance().text
        raise self.error(f"expected a value, found {token}")

    def end_of_line(self) -> None:
        if self.at(Kind.EOF):
            return
        self.expect(Kind.NEWLINE)

    def skip_newlines(self) -> None:
        while self.accept(Kind.NEWLINE):
            pass

    # grammar -----------------------------------------------------------

    def parse(self) -> SchemeDecl:
        self.skip_newlines()
        while not self.at(Kind.EOF):
            self.declaration()
            self.skip_newlines()
        return self.scheme

    def declaration(self) -> None:
        token = self.current
        if token.kind is not Kind.IDENT:
            raise self.error(f"expected a declaration, found {token}")
        handler = {
            "scheme": self.scheme_block,
            "node": self.node_decl,
            "edge": self.edge_decl,
            "section": self.section_decl,
            "signal": self.signal_decl,
            "crossing": self.crossing_decl,
            "trap": self.trap_decl,
            "include": self.include_decl,
            "standards": self.standards_block,
        }.get(token.text)
        if handler is None:
            raise self.error(f"unknown declaration {token.text!r}")
        handler()

    def scheme_block(self) -> None:
        self.expect(Kind.IDENT, "scheme")
        self.scheme.name = self.ident()
        self.expect(Kind.LBRACE)
        self.skip_newlines()
        while not self.at(Kind.RBRACE):
            key = self.ident()
            value = self.word_or_string()
            if key == "area":
                self.scheme.area = value
            elif key == "prefix":
                self.scheme.prefix = value
            else:
                raise self.error(f"unknown scheme setting {key!r}")
            self.skip_newlines()
        self.expect(Kind.RBRACE)
        self.end_of_line()

    def node_decl(self) -> None:
        line = self.current.line
        self.expect(Kind.IDENT, "node")
        name = self.ident()
        word = self.ident()
        kind = NodeKind.from_word(word)
        if kind is None:
            raise self.error(f"{word!r} is not a kind of node")
        attributes = self.trailing_attributes(set())
        self.end_of_line()
        self.scheme.nodes.append(NodeDecl(name, kind, line, attributes))

    def edge_decl(self) -> None:
        line = self.current.line
        self.expect(Kind.IDENT, "edge")
        name = self.ident()
        self.expect(Kind.IDENT, "from")
        start = self.end_ref()
        self.expect(Kind.IDENT, "to")
        end = self.end_ref()

        length: float | None = None
        speed: float | None = None
        gradient: str | None = None
        attributes: dict[str, str] = {}

        while self.at(Kind.IDENT):
            key = self.ident()
            if key == "length":
                length = self.number()
            elif key == "speed":
                speed = self.number()
            elif key == "gradient":
                gradient = self.gradient_value()
            elif key == "direction":
                attributes["direction"] = self.traffic_direction()
            else:
                attributes[key] = self.word_or_string()

        if length is None:
            raise self.error(f"edge {name} has no length")
        self.end_of_line()
        self.scheme.edges.append(
            EdgeDecl(name, start, end, length, line, speed, gradient, attributes)
        )

    def traffic_direction(self) -> str:
        word = self.ident()
        if word not in TRAFFIC_DIRECTIONS:
            raise self.error(
                f"{word!r} is not a traffic direction, "
                f"use one of {', '.join(TRAFFIC_DIRECTIONS)}"
            )
        return word

    def gradient_value(self) -> str:
        if self.at(Kind.IDENT, "level"):
            self.advance()
            return "level"
        first = self.expect(Kind.NUMBER).text
        self.expect(Kind.IDENT, "in")
        rest = self.expect(Kind.NUMBER).text
        return f"{first} in {rest}"

    def end_ref(self) -> EndRef:
        node = self.ident()
        if self.accept(Kind.DOT):
            return EndRef(node, self.ident())
        return EndRef(node)

    def section_decl(self) -> None:
        line = self.current.line
        self.expect(Kind.IDENT, "section")
        name = self.ident()
        kind = SectionKind.TRACK_CIRCUIT
        if self.at(Kind.IDENT, "counted"):
            self.advance()
            kind = SectionKind.AXLE_COUNTER
        self.expect(Kind.IDENT, "over")
        edges = [self.ident()]
        while self.accept(Kind.COMMA):
            edges.append(self.ident())
        self.end_of_line()
        self.scheme.sections.append(SectionDecl(name, edges, kind, line))

    def signal_decl(self) -> None:
        line = self.current.line
        self.expect(Kind.IDENT, "signal")
        name = self.ident()
        self.expect(Kind.IDENT, "on")
        edge = self.ident()
        self.expect(Kind.IDENT, "at")
        offset = self.number()
        self.expect(Kind.IDENT, "facing")
        word = self.ident()
        facing = Facing.from_word(word)
        if facing is None:
            raise self.error(f"{word!r} is not a facing, use forward or backward")

        aspects = 3
        attributes: dict[str, str] = {}
        while self.at(Kind.IDENT):
            key = self.ident()
            if key == "aspects":
                aspects = int(self.number())
            elif key == "direction":
                attributes["direction"] = self.traffic_direction()
            else:
                attributes[key] = self.word_or_string()

        self.end_of_line()
        self.scheme.signals.append(
            SignalDecl(name, edge, offset, facing, aspects, line, attributes)
        )

    def standards_block(self) -> None:
        self.expect(Kind.IDENT, "standards")
        self.expect(Kind.LBRACE)
        self.skip_newlines()
        while not self.at(Kind.RBRACE):
            key = self.ident()
            raw = self.expect(Kind.NUMBER).text
            self.scheme.standards[key] = float(raw)
            self.skip_newlines()
        self.expect(Kind.RBRACE)
        self.end_of_line()

    def include_decl(self) -> None:
        self.expect(Kind.IDENT, "include")
        token = self.current
        if token.kind not in (Kind.STRING, Kind.IDENT):
            raise self.error(f"include wants a file name, found {token}")
        self.advance()
        self.end_of_line()
        self.scheme.includes.append(token.text)

    def crossing_decl(self) -> None:
        line = self.current.line
        self.expect(Kind.IDENT, "crossing")
        name = self.ident()
        self.expect(Kind.IDENT, "on")
        edge = self.ident()
        self.expect(Kind.IDENT, "at")
        offset = self.number()

        kind = CrossingKind.MANUAL_BARRIER
        attributes: dict[str, str] = {}
        while self.at(Kind.IDENT):
            key = self.ident()
            if key == "type":
                word = self.ident()
                found = CrossingKind.from_word(word)
                if found is None:
                    raise self.error(
                        f"{word!r} is not a kind of level crossing, use one of "
                        + ", ".join(member.value for member in CrossingKind)
                    )
                kind = found
            else:
                attributes[key] = self.word_or_string()

        self.end_of_line()
        self.scheme.crossings.append(CrossingDecl(name, edge, offset, kind, line, attributes))

    def trap_decl(self) -> None:
        line = self.current.line
        self.expect(Kind.IDENT, "trap")
        name = self.ident()
        self.expect(Kind.IDENT, "on")
        edge = self.ident()
        self.expect(Kind.IDENT, "at")
        offset = self.number()

        facing = Facing.FORWARD
        attributes: dict[str, str] = {}
        while self.at(Kind.IDENT):
            key = self.ident()
            if key == "facing":
                word = self.ident()
                found = Facing.from_word(word)
                if found is None:
                    raise self.error(f"{word!r} is not a facing, use forward or backward")
                facing = found
            else:
                attributes[key] = self.word_or_string()

        self.end_of_line()
        self.scheme.traps.append(TrapDecl(name, edge, offset, facing, line, attributes))

    def trailing_attributes(self, known: set[str]) -> dict[str, str]:
        attributes: dict[str, str] = {}
        while self.at(Kind.IDENT):
            key = self.ident()
            attributes[key] = self.word_or_string()
        del known
        return attributes


def parse(text: str, *, source: str = "<string>") -> SchemeDecl:
    """Parse scheme plan text into declarations."""
    return Parser(tokenize(text, source=source), source).parse()
