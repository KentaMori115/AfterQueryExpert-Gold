"""Keyword tables for the SlateQL dialect.

``RESERVED`` keywords can never be used as a bare identifier; ``NON_RESERVED``
keywords are contextual and may appear as column or table names.  Keeping the
reserved set small keeps real-world column names such as ``value`` or ``name``
usable without quoting.
"""

from __future__ import annotations

__all__ = [
    "RESERVED",
    "NON_RESERVED",
    "KEYWORDS",
    "is_keyword",
    "is_reserved",
    "TYPE_KEYWORDS",
    "JOIN_KEYWORDS",
]

RESERVED = frozenset(
    {
        "ALL",
        "AND",
        "AS",
        "ASC",
        "BETWEEN",
        "BY",
        "CASE",
        "CAST",
        "CROSS",
        "DESC",
        "DISTINCT",
        "ELSE",
        "END",
        "ESCAPE",
        "EXPLAIN",
        "FALSE",
        "FROM",
        "FULL",
        "GROUP",
        "HAVING",
        "IN",
        "INNER",
        "IS",
        "JOIN",
        "LEFT",
        "LIKE",
        "LIMIT",
        "NOT",
        "NULL",
        "NULLS",
        "OFFSET",
        "ON",
        "OR",
        "ORDER",
        "OUTER",
        "RIGHT",
        "SELECT",
        "THEN",
        "TRUE",
        "UNION",
        "WHEN",
        "WHERE",
    }
)

NON_RESERVED = frozenset(
    {
        "FIRST",
        "LAST",
        "SHOW",
        "TABLES",
        "COLUMNS",
        "INDEXES",
        "DESCRIBE",
        "VALUES",
        "USING",
        "NATURAL",
    }
)

TYPE_KEYWORDS = frozenset(
    {
        "BIGINT",
        "BOOL",
        "BOOLEAN",
        "CHAR",
        "DATE",
        "DATETIME",
        "DECIMAL",
        "DOUBLE",
        "FLOAT",
        "INT",
        "INTEGER",
        "INTERVAL",
        "NUMERIC",
        "REAL",
        "SMALLINT",
        "STRING",
        "TEXT",
        "TIMESTAMP",
        "VARCHAR",
    }
)

JOIN_KEYWORDS = frozenset({"INNER", "LEFT", "RIGHT", "FULL", "CROSS", "JOIN", "OUTER"})

KEYWORDS = RESERVED | NON_RESERVED | TYPE_KEYWORDS


def is_keyword(word: str) -> bool:
    """Whether ``word`` (case-insensitively) is any kind of keyword."""

    return word.upper() in KEYWORDS


def is_reserved(word: str) -> bool:
    """Whether ``word`` may not be used as a bare identifier."""

    return word.upper() in RESERVED
