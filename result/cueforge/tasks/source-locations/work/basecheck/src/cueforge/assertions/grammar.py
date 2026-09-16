"""Lark grammar for Paper Tech assertions."""

from __future__ import annotations

from dataclasses import dataclass

from lark import Lark, Transformer, Token
from lark.exceptions import LarkError

from cueforge.codes import CF6002_ASSERTION_SYNTAX
from cueforge.findings import Finding, Severity

GRAMMAR = r"""
start: statement
statement: cue_attr "before" cue_attr        -> before
         | cue_attr "after" cue_attr         -> after
         | ident ".state" "==" ident "at" cue_attr -> state_at
cue_attr: ident "." ident
ident: CNAME | IDENTIFIER
IDENTIFIER: /[A-Za-z_][A-Za-z0-9_\-]*/
%import common.CNAME
%import common.WS
%ignore WS
"""

_PARSER = Lark(GRAMMAR, start="start", parser="lalr")


@dataclass(frozen=True, slots=True)
class CueAttr:
    cue_id: str
    attr: str


@dataclass(frozen=True, slots=True)
class BeforeExpr:
    left: CueAttr
    right: CueAttr
    kind: str = "before"


@dataclass(frozen=True, slots=True)
class AfterExpr:
    left: CueAttr
    right: CueAttr
    kind: str = "after"


@dataclass(frozen=True, slots=True)
class StateAtExpr:
    resource_id: str
    expected: str
    at: CueAttr
    kind: str = "state_at"


AssertionExpr = BeforeExpr | AfterExpr | StateAtExpr


class _Transformer(Transformer[Token, AssertionExpr]):
    def ident(self, items: list[Token]) -> str:
        return str(items[0])

    def cue_attr(self, items: list[str]) -> CueAttr:
        return CueAttr(cue_id=items[0], attr=items[1])

    def before(self, items: list[object]) -> BeforeExpr:
        left, right = items
        assert isinstance(left, CueAttr) and isinstance(right, CueAttr)
        return BeforeExpr(left=left, right=right)

    def after(self, items: list[object]) -> AfterExpr:
        left, right = items
        assert isinstance(left, CueAttr) and isinstance(right, CueAttr)
        return AfterExpr(left=left, right=right)

    def state_at(self, items: list[object]) -> StateAtExpr:
        resource_id, expected, at = items
        assert isinstance(resource_id, str) and isinstance(expected, str)
        assert isinstance(at, CueAttr)
        return StateAtExpr(resource_id=resource_id, expected=expected, at=at)

    def start(self, items: list[AssertionExpr]) -> AssertionExpr:
        return items[0]


def parse_assertion(expression: str) -> tuple[AssertionExpr | None, Finding | None]:
    try:
        tree = _PARSER.parse(expression)
        expr = _Transformer().transform(tree)
        return expr, None
    except LarkError as exc:
        return None, Finding(
            code=CF6002_ASSERTION_SYNTAX,
            severity=Severity.ERROR,
            message=f"invalid assertion: {expression!r} ({exc})",
            subject_kind="assertion",
            subject_id=expression,
        )
