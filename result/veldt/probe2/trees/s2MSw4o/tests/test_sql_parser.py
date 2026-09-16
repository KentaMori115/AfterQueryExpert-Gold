"""Tests for the SQL statement parser."""

from __future__ import annotations

import pytest

from veldt.errors import ParseError, UnsupportedFeatureError
from veldt.expr.ast import AggregateCall, Alias, ColumnRef
from veldt.sql.keywords import is_reserved, join_type_for, set_operator_for
from veldt.sql.parser import flatten_set_operations
from veldt.sql.lexer import describe_tokens, lex, split_statements, strip_terminator
from veldt.sql.parser import SelectStatement, parse_select


class TestLexerHelpers:
    def test_an_empty_statement_is_rejected(self):
        with pytest.raises(ParseError):
            lex("   ")

    def test_a_comment_only_statement_is_rejected(self):
        with pytest.raises(ParseError):
            lex("-- nothing here")

    def test_the_terminator_is_stripped(self):
        assert len(strip_terminator(lex("SELECT 1;"))) == len(lex("SELECT 1"))

    def test_scripts_split_on_semicolons(self):
        assert split_statements("SELECT 1; SELECT 2") == ["SELECT 1", "SELECT 2"]

    def test_semicolons_inside_strings_are_not_separators(self):
        assert split_statements("SELECT 'a;b'") == ["SELECT 'a;b'"]

    def test_trailing_semicolons_do_not_add_statements(self):
        assert split_statements("SELECT 1;") == ["SELECT 1"]

    def test_tokens_can_be_described(self):
        assert "keyword:SELECT" in describe_tokens(lex("SELECT 1"))

    def test_clause_words_are_reserved(self):
        assert is_reserved("where")
        assert not is_reserved("amount")

    def test_join_keywords_map_to_types(self):
        assert join_type_for("LEFT") == "left"
        assert join_type_for("nope") is None


class TestSelectParsing:
    def test_parses_a_projection_list(self):
        statement = parse_select("SELECT a, b FROM t")
        assert [item.to_sql() for item in statement.projections] == ["a", "b"]

    def test_recognises_a_bare_star(self):
        assert parse_select("SELECT * FROM t").has_star

    def test_recognises_a_qualified_star(self):
        statement = parse_select("SELECT t.* FROM t")
        assert statement.projections[0] == ColumnRef("*", "t")

    def test_explicit_aliases(self):
        statement = parse_select("SELECT a AS x FROM t")
        assert isinstance(statement.projections[0], Alias)
        assert statement.projections[0].name == "x"

    def test_implicit_aliases(self):
        statement = parse_select("SELECT a x FROM t")
        assert statement.projections[0].name == "x"

    def test_distinct_is_recorded(self):
        assert parse_select("SELECT DISTINCT a FROM t").distinct

    def test_table_aliases(self):
        statement = parse_select("SELECT a FROM t AS x")
        assert statement.from_table.alias == "x"
        assert statement.from_table.key == "x"

    def test_the_table_key_falls_back_to_its_name(self):
        assert parse_select("SELECT a FROM t").from_table.key == "t"

    def test_where_clause(self):
        assert parse_select("SELECT a FROM t WHERE a > 1").where.to_sql() == "(a > 1)"

    def test_group_by_and_having(self):
        statement = parse_select("SELECT a FROM t GROUP BY a HAVING count(*) > 1")
        assert len(statement.group_by) == 1
        assert statement.having is not None

    def test_having_without_grouping_or_aggregates_is_rejected(self):
        with pytest.raises(ParseError):
            parse_select("SELECT a FROM t HAVING a > 1")

    def test_having_with_an_aggregate_needs_no_group_by(self):
        assert parse_select("SELECT count(*) FROM t HAVING count(*) > 1").having is not None

    def test_order_by_defaults_to_ascending(self):
        key = parse_select("SELECT a FROM t ORDER BY a").order_by[0]
        assert key.ascending and key.nulls_first is None

    def test_order_by_direction_and_null_placement(self):
        key = parse_select("SELECT a FROM t ORDER BY a DESC NULLS LAST").order_by[0]
        assert key.ascending is False and key.nulls_first is False

    def test_order_by_accepts_several_keys(self):
        assert len(parse_select("SELECT a FROM t ORDER BY a, b DESC").order_by) == 2

    def test_a_dangling_nulls_keyword_is_rejected(self):
        with pytest.raises(ParseError):
            parse_select("SELECT a FROM t ORDER BY a NULLS")

    def test_limit_and_offset(self):
        statement = parse_select("SELECT a FROM t LIMIT 5 OFFSET 2")
        assert (statement.limit, statement.offset) == (5, 2)

    def test_offset_may_come_first(self):
        statement = parse_select("SELECT a FROM t OFFSET 2 LIMIT 5")
        assert (statement.limit, statement.offset) == (5, 2)

    def test_a_fractional_limit_is_rejected(self):
        with pytest.raises(ParseError):
            parse_select("SELECT a FROM t LIMIT 1.5")

    def test_a_missing_from_clause_is_allowed_by_the_parser(self):
        assert parse_select("SELECT 1").from_table is None

    def test_non_select_statements_are_rejected(self):
        with pytest.raises(UnsupportedFeatureError):
            parse_select("DELETE FROM t")

    def test_a_bare_word_after_the_table_reads_as_an_alias(self):
        assert parse_select("SELECT a FROM t x").from_table.alias == "x"

    def test_trailing_tokens_are_rejected(self):
        with pytest.raises(ParseError):
            parse_select("SELECT a FROM t LIMIT 5 nonsense")

    def test_a_trailing_semicolon_is_accepted(self):
        assert parse_select("SELECT a FROM t;").from_table.name == "t"


class TestJoinParsing:
    def test_a_bare_join_is_an_inner_join(self):
        statement = parse_select("SELECT a FROM t JOIN u ON t.a = u.a")
        assert statement.joins[0].how == "inner"

    def test_outer_is_optional(self):
        for text, expected in [
            ("LEFT JOIN", "left"),
            ("LEFT OUTER JOIN", "left"),
            ("RIGHT JOIN", "right"),
            ("FULL OUTER JOIN", "full"),
        ]:
            statement = parse_select(f"SELECT a FROM t {text} u ON t.a = u.a")
            assert statement.joins[0].how == expected

    def test_cross_joins_take_no_condition(self):
        statement = parse_select("SELECT a FROM t CROSS JOIN u")
        assert statement.joins[0].how == "cross"
        assert statement.joins[0].condition is None

    def test_a_cross_join_with_a_condition_is_rejected(self):
        with pytest.raises(ParseError):
            parse_select("SELECT a FROM t CROSS JOIN u ON t.a = u.a")

    def test_an_inner_join_without_a_condition_is_rejected(self):
        with pytest.raises(ParseError):
            parse_select("SELECT a FROM t JOIN u")

    def test_using_is_not_supported(self):
        with pytest.raises(UnsupportedFeatureError):
            parse_select("SELECT a FROM t JOIN u USING (a)")

    def test_several_joins_chain(self):
        statement = parse_select(
            "SELECT a FROM t JOIN u ON t.a = u.a LEFT JOIN v ON t.a = v.a"
        )
        assert [clause.how for clause in statement.joins] == ["inner", "left"]

    def test_every_table_is_listed(self):
        statement = parse_select("SELECT a FROM t JOIN u ON t.a = u.a")
        assert [ref.name for ref in statement.table_refs()] == ["t", "u"]


class TestSetOperations:
    def test_union_defaults_to_distinct(self):
        statement = parse_select("SELECT a FROM t UNION SELECT b FROM u")
        assert statement.set_operation.kind == "union"
        assert statement.set_operation.all is False

    def test_union_all_is_recognised(self):
        statement = parse_select("SELECT a FROM t UNION ALL SELECT b FROM u")
        assert statement.set_operation.all is True

    def test_the_right_side_is_a_full_statement(self):
        statement = parse_select("SELECT a FROM t UNION SELECT b FROM u WHERE b > 1")
        assert statement.set_operation.statement.where is not None

    def test_unions_chain(self):
        statement = parse_select(
            "SELECT a FROM t UNION SELECT b FROM u UNION SELECT c FROM v"
        )
        assert statement.set_operation.statement.set_operation is not None

    def test_intersect_and_except_are_recognised(self):
        for keyword in ["INTERSECT", "EXCEPT"]:
            statement = parse_select(f"SELECT a FROM t {keyword} SELECT b FROM u")
            assert statement.set_operation.kind == keyword.lower()
            assert statement.set_operation.all is False

    def test_intersect_and_except_take_all(self):
        for keyword in ["INTERSECT", "EXCEPT"]:
            statement = parse_select(f"SELECT a FROM t {keyword} ALL SELECT b FROM u")
            assert statement.set_operation.all is True

    def test_every_set_operator_is_known(self):
        assert set_operator_for("union") == "union"
        assert set_operator_for("Intersect") == "intersect"
        assert set_operator_for("EXCEPT") == "except"
        assert set_operator_for("join") is None

    def test_intersect_binds_tighter_than_the_others(self):
        statement = parse_select(
            "SELECT a FROM t UNION SELECT b FROM u INTERSECT SELECT c FROM v"
        )
        _, operators = flatten_set_operations(statement)
        assert [item.kind for item in operators] == ["union", "intersect"]
        assert operators[1].precedence > operators[0].precedence

    def test_union_and_except_bind_equally(self):
        statement = parse_select(
            "SELECT a FROM t UNION SELECT b FROM u EXCEPT SELECT c FROM v"
        )
        _, operators = flatten_set_operations(statement)
        assert operators[0].precedence == operators[1].precedence

    def test_a_chain_flattens_to_terms_and_operators(self):
        statement = parse_select(
            "SELECT a FROM t INTERSECT ALL SELECT b FROM u EXCEPT SELECT c FROM v"
        )
        terms, operators = flatten_set_operations(statement)
        assert [term.from_table.name for term in terms] == ["t", "u", "v"]
        assert [(item.kind, item.all) for item in operators] == [
            ("intersect", True),
            ("except", False),
        ]
        assert all(term.set_operation is None for term in terms)

    def test_a_statement_without_one_flattens_to_itself(self):
        statement = parse_select("SELECT a FROM t")
        terms, operators = flatten_set_operations(statement)
        assert terms == [statement]
        assert operators == []

    def test_trailing_clauses_stay_on_the_last_term(self):
        statement = parse_select(
            "SELECT a FROM t EXCEPT SELECT b FROM u ORDER BY a LIMIT 2 OFFSET 1"
        )
        terms, _ = flatten_set_operations(statement)
        assert terms[0].order_by == () and terms[0].limit is None
        assert terms[-1].order_by and terms[-1].limit == 2 and terms[-1].offset == 1

    def test_describe_round_trips_a_chain(self):
        text = "SELECT a FROM t INTERSECT ALL SELECT b FROM u"
        assert parse_select(text).describe() == text

    def test_set_operators_may_not_be_bare_aliases(self):
        assert is_reserved("intersect")
        assert is_reserved("except")


class TestDescribe:
    def test_round_trips_the_important_clauses(self):
        text = (
            "SELECT DISTINCT a, count(*) AS n FROM t JOIN u ON t.a = u.a "
            "WHERE a > 1 GROUP BY a HAVING count(*) > 1 ORDER BY n DESC LIMIT 5 OFFSET 2"
        )
        rendered = parse_select(text).describe()
        for fragment in ["DISTINCT", "INNER JOIN", "WHERE", "GROUP BY", "HAVING", "LIMIT 5"]:
            assert fragment in rendered
