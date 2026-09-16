"""The lexer cursor, which is the only thing that moves through the text.

Every position in every error message comes out of this, so it is worth testing
on its own rather than only through the tokens that come out the other end.
"""

from __future__ import annotations

import pytest

from signalbox.errors import ParseError
from signalbox.layout.tokens import Kind, _Cursor, _next_scanner, tokenize


def cursor(text: str) -> _Cursor:
    return _Cursor(text, "plan.sbx")


def test_a_new_cursor_starts_at_the_beginning():
    found = cursor("node A")
    assert found.at == 0
    assert found.line == 1
    assert found.column == 1
    assert found.here == "n"


def test_an_empty_cursor_is_done():
    assert cursor("").done
    assert not cursor("x").done


def test_taking_moves_the_column_but_not_the_line():
    found = cursor("node")
    found.take(2)
    assert found.at == 2
    assert found.column == 3
    assert found.line == 1


def test_a_newline_moves_the_line_and_resets_the_column():
    found = cursor("a\nb")
    found.take()
    found.newline()
    assert found.line == 2
    assert found.column == 1


def test_peeking_does_not_move():
    found = cursor("ab")
    assert found.peek() == "b"
    assert found.at == 0


def test_peeking_past_the_end_gives_nothing():
    assert cursor("a").peek() == ""
    assert cursor("a").peek(9) == ""


def test_eating_stops_at_the_first_character_it_does_not_want():
    found = cursor("123abc")
    found.eat_while(set("0123456789"))
    assert found.at == 3


def test_eating_a_number_takes_one_decimal_point():
    found = cursor("150.5m")
    found.eat_number()
    assert found.text[: found.at] == "150.5"


def test_eating_a_number_leaves_a_trailing_dot_alone():
    found = cursor("150.")
    found.eat_number()
    assert found.text[: found.at] == "150"


def test_a_failure_carries_the_line_it_was_on():
    found = cursor("a\nb")
    found.take()
    found.newline()
    error = found.fail("something")
    assert isinstance(error, ParseError)
    assert "plan.sbx:2" in str(error)


def test_a_scanner_is_chosen_for_every_kind_of_character():
    for text in ("\n", " ", "#", "->", "-4", "+4", "{", '"a"', "12", "abc"):
        assert _next_scanner(cursor(text)) is not None, text


def test_nothing_is_chosen_for_a_character_the_language_has_not_got():
    assert _next_scanner(cursor("@")) is None


def test_the_scanners_between_them_lex_a_whole_plan():
    text = (
        'scheme x {\n  area "A Name"\n}\n'
        "# a comment\n"
        "edge E1 from A to B length 150.5 gradient 1 in -220\n"
        "at +10 train 1A05\n"
    )
    kinds = {token.kind for token in tokenize(text)}
    assert {Kind.IDENT, Kind.NUMBER, Kind.STRING, Kind.LBRACE, Kind.NEWLINE} <= kinds


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("1A05", Kind.IDENT),
        ("150", Kind.NUMBER),
        ("-220", Kind.NUMBER),
        ("+10", Kind.NUMBER),
        ('"a name"', Kind.STRING),
        ("->", Kind.ARROW),
    ],
)
def test_each_scanner_produces_the_token_it_should(text, expected):
    assert tokenize(text)[0].kind is expected
