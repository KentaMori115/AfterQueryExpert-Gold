"""The SQL surface: keywords, lexing, parsing and compilation."""

from __future__ import annotations

from .compiler import SqlCompiler, compile_select, compile_sql
from .keywords import (
    CLAUSE_KEYWORDS,
    JOIN_KEYWORDS,
    RESERVED,
    SET_OPERATORS,
    is_reserved,
    join_type_for,
    set_operator_for,
    set_operator_precedence,
)
from .lexer import describe_tokens, lex, split_statements, strip_terminator
from .parser import (
    JoinClause,
    SelectStatement,
    SetOperation,
    SqlParser,
    TableRef,
    parse_select,
)

__all__ = [
    "CLAUSE_KEYWORDS",
    "JOIN_KEYWORDS",
    "JoinClause",
    "RESERVED",
    "SET_OPERATORS",
    "SelectStatement",
    "SetOperation",
    "SqlCompiler",
    "SqlParser",
    "TableRef",
    "compile_select",
    "compile_sql",
    "describe_tokens",
    "is_reserved",
    "join_type_for",
    "lex",
    "parse_select",
    "set_operator_for",
    "set_operator_precedence",
    "split_statements",
    "strip_terminator",
]
