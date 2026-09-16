import pytest

from signalbox.errors import ParseError
from signalbox.layout.tokens import Kind, tokenize


def kinds(text):
    return [t.kind for t in tokenize(text)]


def test_empty_input_is_just_eof():
    assert kinds("") == [Kind.EOF]


def test_identifiers_may_contain_digits_and_slashes():
    toks = tokenize("K12 P105A up/down")
    assert [t.text for t in toks[:3]] == ["K12", "P105A", "up/down"]


def test_numbers_keep_their_decimal_part():
    toks = tokenize("12 34.5")
    assert [t.text for t in toks if t.kind is Kind.NUMBER] == ["12", "34.5"]


def test_a_trailing_dot_is_punctuation_not_a_decimal():
    toks = tokenize("P105.normal")
    assert [t.kind for t in toks[:3]] == [Kind.IDENT, Kind.DOT, Kind.IDENT]


def test_comments_are_dropped():
    assert kinds("# nothing here\n") == [Kind.EOF]


def test_blank_lines_collapse():
    toks = [t for t in tokenize("a\n\n\nb\n") if t.kind is Kind.NEWLINE]
    assert len(toks) == 2


def test_strings_handle_escapes():
    toks = tokenize(r'"Kingsmoor \"West\" box"')
    assert toks[0].text == 'Kingsmoor "West" box'


def test_unterminated_string_is_reported_with_a_line():
    with pytest.raises(ParseError) as excinfo:
        tokenize('area "Kingsmoor\n', source="plan.sbx")
    assert "plan.sbx:1" in str(excinfo.value)


def test_arrow_is_one_token():
    toks = tokenize("A -> B")
    assert toks[1].kind is Kind.ARROW


def test_positions_are_one_based():
    toks = tokenize("edge E1\n  from A")
    assert (toks[0].line, toks[0].column) == (1, 1)
    from_token = next(t for t in toks if t.text == "from")
    assert (from_token.line, from_token.column) == (2, 3)


def test_stray_character_is_rejected():
    with pytest.raises(ParseError):
        tokenize("edge E1 @ 400")


def test_falling_gradients_lex_as_negative_numbers():
    toks = tokenize("gradient 1 in -220")
    assert [t.text for t in toks if t.kind is Kind.NUMBER] == ["1", "-220"]


def test_a_lone_minus_is_still_rejected():
    with pytest.raises(ParseError):
        tokenize("length - 10")


def test_a_headcode_is_an_identifier_not_a_number():
    toks = tokenize("train 1A05 on D1")
    assert [t.kind for t in toks[:4]] == [Kind.IDENT, Kind.IDENT, Kind.IDENT, Kind.IDENT]
    assert toks[1].text == "1A05"


def test_a_plain_number_is_still_a_number():
    toks = tokenize("length 80")
    assert toks[1].kind is Kind.NUMBER


def test_a_number_followed_by_a_space_and_a_word_stays_a_number():
    toks = tokenize("1 in 330")
    assert [t.kind for t in toks[:3]] == [Kind.NUMBER, Kind.IDENT, Kind.NUMBER]


def test_a_relative_time_lexes_as_a_number():
    toks = tokenize("at +10 note")
    assert [t.text for t in toks if t.kind is Kind.NUMBER] == ["+10"]


def test_a_lone_plus_is_rejected():
    with pytest.raises(ParseError):
        tokenize("at + 10")
