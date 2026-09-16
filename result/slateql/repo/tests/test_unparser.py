"""Tests for rendering an AST back to SQL."""

from __future__ import annotations

import pytest

from slateql.sql.parser import parse, parse_expression
from slateql.sql.unparser import literal_sql, unparse, unparse_expression

ROUND_TRIP_QUERIES = [
    "SELECT a FROM t",
    "SELECT DISTINCT a, b FROM t",
    "SELECT a AS x FROM t WHERE a > 1",
    "SELECT a FROM t ORDER BY a DESC LIMIT 5 OFFSET 2",
    "SELECT COUNT(*) FROM t",
    "SELECT SUM(DISTINCT a) FROM t",
    "SELECT a FROM t JOIN u ON t.a = u.b",
    "SELECT a FROM t LEFT JOIN u ON t.a = u.b",
    "SELECT a FROM t CROSS JOIN u",
    "SELECT a FROM t GROUP BY a HAVING COUNT(*) > 1",
    "SELECT a FROM t UNION ALL SELECT b FROM u",
    "SELECT CAST(a AS INTEGER) FROM t",
    "SELECT a FROM t WHERE a IN (1, 2, 3)",
    "SELECT a FROM t WHERE a NOT BETWEEN 1 AND 2",
    "SELECT a FROM t WHERE a IS NOT NULL",
    "SELECT a FROM t WHERE a LIKE 'x%' ESCAPE '!'",
]


@pytest.mark.parametrize("query", ROUND_TRIP_QUERIES)
def test_round_trip_is_stable(query):
    once = unparse(parse(query))
    twice = unparse(parse(once))
    assert once == twice


def test_identifiers_are_quoted_only_when_needed():
    assert unparse_expression(parse_expression("abc")) == "abc"
    assert unparse_expression(parse_expression('"a b"')) == '"a b"'


def test_string_literals_escape_quotes():
    assert literal_sql("it's") == "'it''s'"


def test_boolean_and_null_literals():
    assert literal_sql(True) == "TRUE"
    assert literal_sql(None) == "NULL"


def test_binary_expressions_are_fully_parenthesised():
    assert unparse_expression(parse_expression("1 + 2 * 3")) == "(1 + (2 * 3))"


def test_case_expression_renders_all_branches():
    text = unparse_expression(parse_expression("CASE WHEN a THEN 1 ELSE 2 END"))
    assert text == "CASE WHEN a THEN 1 ELSE 2 END"


def test_star_projection_renders_qualified():
    assert unparse(parse("SELECT t.* FROM t")).startswith("SELECT t.*")


def test_explain_prefix_is_preserved():
    assert unparse(parse("EXPLAIN SELECT 1")).startswith("EXPLAIN SELECT")


def test_show_statements_render():
    assert unparse(parse("SHOW TABLES")) == "SHOW TABLES"
    assert unparse(parse("SHOW COLUMNS FROM t")) == "SHOW COLUMNS FROM t"
