"""Tests for the SQL lexer."""

from __future__ import annotations

import pytest

from slateql.errors import LexError
from slateql.sql.lexer import tokenize
from slateql.sql.tokens import TokenType


def kinds(source: str) -> list[TokenType]:
    return [token.type for token in tokenize(source)[:-1]]


def values(source: str) -> list[object]:
    return [token.value for token in tokenize(source)[:-1]]


def test_keywords_are_upper_cased():
    assert values("select FROM Where") == ["SELECT", "FROM", "WHERE"]


def test_identifiers_fold_to_lower_case():
    assert values("MyTable") == ["mytable"]


def test_identifier_folding_can_be_disabled():
    tokens = tokenize("MyTable", fold_identifiers=False)
    assert tokens[0].value == "MyTable"


def test_quoted_identifiers_preserve_case_and_spaces():
    tokens = tokenize('"Order Total"')
    assert tokens[0].type is TokenType.QUOTED_IDENTIFIER
    assert tokens[0].value == "Order Total"


def test_quoted_identifier_unescapes_doubled_quotes():
    assert tokenize('"a""b"')[0].value == 'a"b'


def test_empty_quoted_identifier_is_rejected():
    with pytest.raises(LexError):
        tokenize('""')


def test_string_literal_unescapes_doubled_quotes():
    assert tokenize("'it''s'")[0].value == "it's"


def test_unterminated_string_is_rejected():
    with pytest.raises(LexError):
        tokenize("'abc")


def test_integer_and_float_literals():
    assert values("1 2.5 3e2 4.5e-1") == [1, 2.5, 300.0, 0.45]


def test_number_followed_by_letters_is_rejected():
    with pytest.raises(LexError):
        tokenize("12abc")


def test_line_comments_are_skipped():
    assert values("1 -- comment\n2") == [1, 2]


def test_block_comments_nest():
    assert values("1 /* a /* b */ c */ 2") == [1, 2]


def test_unterminated_block_comment_is_rejected():
    with pytest.raises(LexError):
        tokenize("1 /* unterminated")


def test_multi_character_operators():
    assert values("<> != <= >= ||") == ["<>", "!=", "<=", ">=", "||"]


def test_single_pipe_is_rejected_with_a_hint():
    with pytest.raises(LexError) as info:
        tokenize("a | b")
    assert "||" in str(info.value)


def test_positions_track_lines_and_columns():
    tokens = tokenize("select\n  a")
    assert (tokens[1].line, tokens[1].column) == (2, 3)


def test_eof_token_is_always_last():
    tokens = tokenize("select 1")
    assert tokens[-1].is_eof
    assert kinds("select 1") == [TokenType.KEYWORD, TokenType.NUMBER]


def test_unexpected_character_is_rejected():
    with pytest.raises(LexError):
        tokenize("select #")
