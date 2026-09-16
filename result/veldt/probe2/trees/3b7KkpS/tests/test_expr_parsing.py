"""Tests for the tokenizer and the expression parser."""

from __future__ import annotations

import pytest

from veldt.errors import ParseError, UnexpectedTokenError
from veldt.expr.ast import (
    AggregateCall,
    Alias,
    Between,
    BinaryOp,
    CaseWhen,
    Cast,
    ColumnRef,
    FunctionCall,
    InList,
    IsNull,
    Literal,
    UnaryOp,
    collect_aggregates,
    collect_columns,
    contains_aggregate,
    output_name,
    transform,
    walk,
)
from veldt.expr.parser import parse_expression
from veldt.expr.tokenizer import TokenType, tokenize
from veldt.types.dtypes import DataType


def types_of(source):
    return [token.type for token in tokenize(source) if not token.is_end()]


def texts_of(source):
    return [token.text for token in tokenize(source) if not token.is_end()]


class TestTokenizer:
    def test_classifies_the_basic_token_kinds(self):
        assert types_of("a = 1") == [
            TokenType.IDENTIFIER,
            TokenType.OPERATOR,
            TokenType.NUMBER,
        ]

    def test_recognises_keywords(self):
        assert types_of("select")[0] is TokenType.KEYWORD

    def test_multi_character_operators_stay_together(self):
        assert texts_of("a <= b >= c || d") == ["a", "<=", "b", ">=", "c", "||", "d"]

    def test_angle_bracket_inequality_normalizes(self):
        assert texts_of("a <> b")[1] == "!="

    def test_string_literals_unescape_doubled_quotes(self):
        tokens = tokenize("'it''s'")
        assert tokens[0].type is TokenType.STRING
        assert tokens[0].text == "it's"

    def test_quoted_identifiers_unescape_doubled_quotes(self):
        tokens = tokenize('"a""b"')
        assert tokens[0].type is TokenType.QUOTED_IDENTIFIER
        assert tokens[0].text == 'a"b'

    def test_empty_quoted_identifier_is_rejected(self):
        with pytest.raises(ParseError):
            tokenize('""')

    def test_numbers_accept_decimals_and_exponents(self):
        assert texts_of("1 2.5 3e4 4.5e-2") == ["1", "2.5", "3e4", "4.5e-2"]

    def test_a_trailing_dot_is_punctuation_not_part_of_the_number(self):
        assert texts_of("t.a") == ["t", ".", "a"]

    def test_line_comments_are_skipped(self):
        assert texts_of("a -- comment\n+ b") == ["a", "+", "b"]

    def test_block_comments_are_skipped(self):
        assert texts_of("a /* note */ + b") == ["a", "+", "b"]

    def test_unterminated_string_is_reported_with_a_position(self):
        with pytest.raises(ParseError) as error:
            tokenize("'abc")
        assert error.value.line == 1

    def test_unterminated_block_comment_is_rejected(self):
        with pytest.raises(ParseError):
            tokenize("a /* forever")

    def test_unknown_character_is_rejected(self):
        with pytest.raises(ParseError):
            tokenize("a # b")

    def test_positions_track_across_lines(self):
        tokens = tokenize("a\n  b")
        assert (tokens[1].line, tokens[1].column) == (2, 3)

    def test_input_always_ends_with_an_end_token(self):
        assert tokenize("").pop().is_end()


class TestExpressionParser:
    def test_multiplication_binds_tighter_than_addition(self):
        assert parse_expression("1 + 2 * 3").to_sql() == "(1 + (2 * 3))"

    def test_comparison_binds_looser_than_arithmetic(self):
        assert parse_expression("a + 1 > 2").to_sql() == "((a + 1) > 2)"

    def test_and_binds_tighter_than_or(self):
        parsed = parse_expression("a OR b AND c")
        assert parsed.operator == "or"
        assert parsed.right.operator == "and"

    def test_parentheses_override_precedence(self):
        assert parse_expression("(1 + 2) * 3").to_sql() == "((1 + 2) * 3)"

    def test_unary_minus_parses(self):
        assert isinstance(parse_expression("-a"), UnaryOp)

    def test_unary_plus_is_dropped(self):
        assert parse_expression("+a") == ColumnRef("a")

    def test_not_applies_to_the_whole_predicate(self):
        assert isinstance(parse_expression("NOT a = 1"), UnaryOp)

    def test_literals_carry_their_type(self):
        assert parse_expression("1").dtype is DataType.INT64
        assert parse_expression("1.5").dtype is DataType.FLOAT64
        assert parse_expression("'x'").dtype is DataType.STRING
        assert parse_expression("true").dtype is DataType.BOOL
        assert parse_expression("null").dtype is DataType.NULL

    def test_qualified_columns_keep_their_qualifier(self):
        parsed = parse_expression("t.a")
        assert parsed == ColumnRef("a", "t")
        assert parsed.qualified_name == "t.a"

    def test_is_null_and_its_negation(self):
        assert parse_expression("a IS NULL") == IsNull(ColumnRef("a"), False)
        assert parse_expression("a IS NOT NULL") == IsNull(ColumnRef("a"), True)

    def test_in_list_and_its_negation(self):
        parsed = parse_expression("a IN (1, 2)")
        assert isinstance(parsed, InList) and len(parsed.options) == 2
        assert parse_expression("a NOT IN (1)").negated

    def test_empty_in_list_is_rejected(self):
        with pytest.raises(ParseError):
            parse_expression("a IN ()")

    def test_between_and_its_negation(self):
        assert isinstance(parse_expression("a BETWEEN 1 AND 5"), Between)
        assert parse_expression("a NOT BETWEEN 1 AND 5").negated

    def test_between_expands_to_comparisons(self):
        expanded = parse_expression("a BETWEEN 1 AND 5").expand()
        assert expanded.to_sql() == "((a >= 1) AND (a <= 5))"

    def test_like_and_not_like(self):
        assert parse_expression("a LIKE 'x%'").operator == "like"
        assert parse_expression("a NOT LIKE 'x%'").operator == "not like"

    def test_function_calls_lowercase_their_name(self):
        parsed = parse_expression("UPPER(a)")
        assert isinstance(parsed, FunctionCall) and parsed.name == "upper"

    def test_aggregates_parse_as_aggregate_calls(self):
        assert isinstance(parse_expression("sum(a)"), AggregateCall)

    def test_count_star_has_no_arguments(self):
        parsed = parse_expression("count(*)")
        assert parsed.is_star and parsed.args == ()

    def test_distinct_inside_an_aggregate(self):
        assert parse_expression("count(DISTINCT a)").distinct

    def test_distinct_outside_an_aggregate_is_rejected(self):
        with pytest.raises(ParseError):
            parse_expression("upper(DISTINCT a)")

    def test_mean_is_an_alias_for_avg(self):
        assert parse_expression("mean(a)").name == "avg"

    def test_searched_case(self):
        parsed = parse_expression("CASE WHEN a > 1 THEN 'x' ELSE 'y' END")
        assert isinstance(parsed, CaseWhen) and len(parsed.branches) == 1

    def test_simple_case_expands_to_equality(self):
        parsed = parse_expression("CASE a WHEN 1 THEN 'x' END")
        assert parsed.branches[0][0].to_sql() == "(a = 1)"

    def test_cast_resolves_the_target_type(self):
        parsed = parse_expression("CAST(a AS bigint)")
        assert isinstance(parsed, Cast) and parsed.target is DataType.INT64

    def test_cast_to_an_unknown_type_is_rejected(self):
        with pytest.raises(ParseError):
            parse_expression("CAST(a AS blob)")

    def test_trailing_tokens_are_rejected(self):
        with pytest.raises(UnexpectedTokenError):
            parse_expression("a b c")

    def test_missing_operand_is_rejected(self):
        with pytest.raises(ParseError):
            parse_expression("a +")


class TestAstHelpers:
    def test_walk_visits_every_node(self):
        assert len(list(walk(parse_expression("a + 1")))) == 3

    def test_collect_columns_deduplicates(self):
        found = collect_columns(parse_expression("a + a + b"))
        assert [item.name for item in found] == ["a", "b"]

    def test_contains_aggregate_detects_nesting(self):
        assert contains_aggregate(parse_expression("sum(a) + 1"))
        assert not contains_aggregate(parse_expression("upper(a)"))

    def test_collect_aggregates_finds_each_call(self):
        found = collect_aggregates(parse_expression("sum(a) + count(*)"))
        assert len(found) == 2

    def test_output_name_prefers_an_alias(self):
        assert output_name(Alias(ColumnRef("a"), "b")) == "b"
        assert output_name(ColumnRef("a")) == "a"
        assert output_name(parse_expression("a + 1")) == "(a + 1)"

    def test_transform_rebuilds_bottom_up(self):
        def bump(node):
            if isinstance(node, Literal) and node.value == 1:
                return Literal(2, DataType.INT64)
            return node

        assert transform(parse_expression("a + 1"), bump).to_sql() == "(a + 2)"

    def test_with_children_rejects_the_wrong_count(self):
        with pytest.raises(ValueError):
            parse_expression("a + 1").with_children([ColumnRef("a")])

    def test_binary_swap_flips_comparisons(self):
        assert BinaryOp("<", ColumnRef("a"), Literal(1)).swap().operator == ">"

    def test_unknown_operators_are_rejected(self):
        with pytest.raises(ValueError):
            BinaryOp("^", ColumnRef("a"), ColumnRef("b"))
