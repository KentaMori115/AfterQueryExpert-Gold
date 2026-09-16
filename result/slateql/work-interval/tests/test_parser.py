"""Tests for the SQL parser."""

from __future__ import annotations

import pytest

from slateql.errors import ParseError
from slateql.sql import ast_nodes as A
from slateql.sql.parser import parse, parse_expression


def test_select_star():
    statement = parse("SELECT * FROM t")
    assert isinstance(statement.projections[0], A.StarProjection)
    assert statement.source == A.NamedTable(name="t", alias=None)


def test_qualified_star():
    statement = parse("SELECT t.* FROM t")
    assert statement.projections[0].qualifier == "t"


def test_alias_forms_are_equivalent():
    with_as = parse("SELECT a AS b FROM t").projections[0]
    without_as = parse("SELECT a b FROM t").projections[0]
    assert with_as == without_as


def test_operator_precedence_multiplication_binds_tighter():
    expression = parse_expression("1 + 2 * 3")
    assert expression.op == "+"
    assert expression.right.op == "*"


def test_and_binds_tighter_than_or():
    expression = parse_expression("a OR b AND c")
    assert expression.op == "OR"
    assert expression.right.op == "AND"


def test_comparison_binds_tighter_than_and():
    expression = parse_expression("a = 1 AND b = 2")
    assert expression.op == "AND"
    assert expression.left.op == "="


def test_between_does_not_swallow_the_following_and():
    expression = parse_expression("x BETWEEN 1 AND 2 AND y = 3")
    assert expression.op == "AND"
    assert isinstance(expression.left, A.Between)
    assert expression.right.op == "="


def test_not_in_is_parsed_as_negated():
    expression = parse_expression("x NOT IN (1, 2)")
    assert isinstance(expression, A.InList)
    assert expression.negated


def test_is_not_null():
    expression = parse_expression("x IS NOT NULL")
    assert isinstance(expression, A.IsNull)
    assert expression.negated


def test_like_with_escape():
    expression = parse_expression("x LIKE 'a!_b' ESCAPE '!'")
    assert isinstance(expression, A.LikeExpr)
    assert expression.escape == A.Literal(value="!", raw="'!'")


def test_negative_number_folds_into_the_literal():
    assert parse_expression("-5") == A.Literal(value=-5, raw="-5")


def test_case_requires_at_least_one_when():
    with pytest.raises(ParseError):
        parse_expression("CASE ELSE 1 END")


def test_simple_case_keeps_its_operand():
    expression = parse_expression("CASE x WHEN 1 THEN 'a' END")
    assert expression.operand == A.ColumnRef(name="x")


def test_cast_accepts_and_discards_type_modifiers():
    expression = parse_expression("CAST(x AS VARCHAR(32))")
    assert expression.type_name == "varchar"


def test_join_without_condition_is_rejected():
    with pytest.raises(ParseError) as info:
        parse("SELECT * FROM a JOIN b")
    assert "ON" in str(info.value)


def test_cross_join_rejects_a_condition():
    with pytest.raises(ParseError):
        parse("SELECT * FROM a CROSS JOIN b ON a.x = b.x")


def test_comma_join_becomes_a_cross_join():
    statement = parse("SELECT * FROM a, b")
    assert statement.source.kind is A.JoinKind.CROSS


def test_outer_keyword_is_optional():
    left = parse("SELECT * FROM a LEFT JOIN b ON a.x = b.x")
    outer = parse("SELECT * FROM a LEFT OUTER JOIN b ON a.x = b.x")
    assert left == outer


def test_using_clause_collects_names():
    statement = parse("SELECT * FROM a JOIN b USING (x, y)")
    assert statement.source.using == ("x", "y")


def test_order_by_nulls_placement():
    item = parse("SELECT a FROM t ORDER BY a DESC NULLS FIRST").order_by[0]
    assert item.descending and item.nulls_first is True


def test_order_by_defaults_leave_null_placement_unset():
    item = parse("SELECT a FROM t ORDER BY a").order_by[0]
    assert item.descending is False and item.nulls_first is None


def test_limit_rejects_a_non_integer():
    with pytest.raises(ParseError):
        parse("SELECT a FROM t LIMIT 1.5")


def test_limit_rejects_a_negative_count():
    with pytest.raises(ParseError):
        parse("SELECT a FROM t LIMIT -1")


def test_trailing_clauses_bind_to_the_whole_union():
    statement = parse("SELECT a FROM t UNION SELECT b FROM u ORDER BY 1")
    assert isinstance(statement, A.SetOperation)
    assert statement.order_by
    assert statement.right.order_by == ()


def test_parenthesised_arm_keeps_its_own_order_by():
    statement = parse("SELECT a FROM t UNION (SELECT b FROM u ORDER BY 1)")
    assert statement.right.order_by


def test_two_statements_are_rejected():
    with pytest.raises(ParseError):
        parse("SELECT 1; SELECT 2")


def test_trailing_semicolon_is_accepted():
    assert parse("SELECT 1;") == parse("SELECT 1")


def test_empty_in_list_is_rejected():
    with pytest.raises(ParseError):
        parse_expression("x IN ()")


def test_explain_wraps_the_statement():
    statement = parse("EXPLAIN SELECT 1")
    assert isinstance(statement, A.ExplainStatement)
    assert isinstance(statement.statement, A.SelectStatement)


def test_show_tables_and_columns():
    assert parse("SHOW TABLES").target == "tables"
    assert parse("SHOW COLUMNS FROM t").table == "t"


def test_parse_errors_report_a_position():
    with pytest.raises(ParseError) as info:
        parse("SELECT FROM t")
    assert info.value.line == 1
    assert info.value.column > 1
