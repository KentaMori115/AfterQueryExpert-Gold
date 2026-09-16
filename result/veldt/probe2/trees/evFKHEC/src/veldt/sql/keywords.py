"""Reserved words and keyword groupings for the SQL surface.

The tokenizer decides what *is* a keyword; this module decides what keywords
*mean* at the statement level: which ones can start a clause, which ones name a
join, and which ones may not be used as a bare identifier.
"""

from __future__ import annotations

from typing import Dict, FrozenSet, Optional

__all__ = [
    "CLAUSE_KEYWORDS",
    "JOIN_KEYWORDS",
    "RESERVED",
    "SET_OPERATORS",
    "SET_OPERATOR_PRECEDENCE",
    "is_reserved",
    "join_type_for",
    "set_operator_precedence",
]

# Keywords that terminate an expression because they begin the next clause.
CLAUSE_KEYWORDS: FrozenSet[str] = frozenset(
    {
        "from",
        "where",
        "group",
        "having",
        "order",
        "limit",
        "offset",
        "union",
        "intersect",
        "except",
        "join",
        "inner",
        "left",
        "right",
        "full",
        "cross",
        "on",
        "using",
    }
)

# The spelling that introduces each join, mapped to the join type it produces.
JOIN_KEYWORDS: Dict[str, str] = {
    "join": "inner",
    "inner": "inner",
    "left": "left",
    "right": "right",
    "full": "full",
    "cross": "cross",
}

# How tightly each set operator binds in a chain of them. ``INTERSECT`` binds
# tighter than the other two, which share a level and associate left to right,
# so ``a UNION b INTERSECT c`` is ``a UNION (b INTERSECT c)`` and
# ``a EXCEPT b UNION c`` is ``(a EXCEPT b) UNION c``.
SET_OPERATOR_PRECEDENCE: Dict[str, int] = {
    "union": 1,
    "except": 1,
    "intersect": 2,
}

SET_OPERATORS: FrozenSet[str] = frozenset(SET_OPERATOR_PRECEDENCE)

# Words that may not be used as a table or column alias without quoting.
RESERVED: FrozenSet[str] = CLAUSE_KEYWORDS | frozenset(
    {
        "and",
        "as",
        "asc",
        "between",
        "by",
        "case",
        "cast",
        "desc",
        "distinct",
        "else",
        "end",
        "false",
        "in",
        "is",
        "like",
        "not",
        "null",
        "or",
        "select",
        "then",
        "true",
        "when",
    }
)


def is_reserved(word: str) -> bool:
    """True when ``word`` may not be used as a bare identifier."""
    return word.lower() in RESERVED


def join_type_for(word: str) -> Optional[str]:
    """Return the join type a keyword introduces, or ``None``."""
    return JOIN_KEYWORDS.get(word.lower())


def set_operator_precedence(word: str) -> Optional[int]:
    """Return how tightly a set operator binds, or ``None`` for other words.

    A larger number binds tighter.
    """
    return SET_OPERATOR_PRECEDENCE.get(word.lower())
