"""The SQL statement parser.

The parser recognises a single statement shape — ``SELECT`` — and produces a
:class:`SelectStatement`, a faithful syntax tree that has not yet been resolved
against any catalog. Turning that into a logical plan is
:mod:`veldt.sql.compiler`'s job.

Supported grammar::

    chain      := intersect_chain ((UNION | EXCEPT) [ALL] intersect_chain)*
    intersect_chain := select_stmt (INTERSECT [ALL] select_stmt)*
    select_stmt := SELECT [DISTINCT] projections
                   [FROM table_ref join*]
                   [WHERE expr]
                   [GROUP BY expr (, expr)*]
                   [HAVING expr]
                   [ORDER BY sort_key (, sort_key)*]
                   [LIMIT n] [OFFSET n]
    table_ref  := identifier [[AS] alias]
    join       := [INNER | LEFT [OUTER] | RIGHT [OUTER] | FULL [OUTER] | CROSS]
                  JOIN table_ref [ON expr]

``INTERSECT`` binds more tightly than ``UNION`` and ``EXCEPT``.  ``UNION``
and ``EXCEPT`` are left-associative and have equal precedence, so
``a EXCEPT b EXCEPT c`` means ``(a EXCEPT b) EXCEPT c`` and
``a UNION b INTERSECT c`` means ``a UNION (b INTERSECT c)``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional, Sequence, Tuple

from ..errors import ParseError, UnsupportedFeatureError
from ..expr.ast import Alias, ColumnRef, Expression
from ..expr.parser import ExpressionParser
from ..expr.tokenizer import Token, TokenType
from ..plan.logical import SortKey
from .keywords import join_type_for
from .lexer import lex, strip_terminator

__all__ = [
    "TableRef",
    "JoinClause",
    "SetOperation",
    "SelectStatement",
    "SqlParser",
    "parse_select",
    "STAR",
]

# A bare ``*`` in a projection list.
STAR = ColumnRef("*")


@dataclass(frozen=True)
class TableRef:
    """A table named in ``FROM`` or ``JOIN``."""

    name: str
    alias: Optional[str] = None

    @property
    def key(self) -> str:
        """The name queries use to qualify this table's columns."""
        return self.alias or self.name

    def describe(self) -> str:
        """Render the reference as it appeared in the query."""
        return f"{self.name} AS {self.alias}" if self.alias else self.name


@dataclass(frozen=True)
class JoinClause:
    """One ``JOIN`` in a ``FROM`` clause."""

    table: TableRef
    condition: Optional[Expression] = None
    how: str = "inner"

    def describe(self) -> str:
        """Render the clause for error messages."""
        if self.condition is None:
            return f"{self.how.upper()} JOIN {self.table.describe()}"
        return f"{self.how.upper()} JOIN {self.table.describe()} ON {self.condition.to_sql()}"


@dataclass(frozen=True)
class SetOperation:
    """A trailing set operation (UNION / INTERSECT / EXCEPT) and the statement
    it combines with.

    The ``kind`` field is one of ``"union"``, ``"intersect"``, ``"except"``.
    When a chain of UNION / EXCEPT operations is present the linked list is
    left-associative: the compiler peels the chain left-first so that
    ``a EXCEPT b EXCEPT c`` becomes ``(a EXCEPT b) EXCEPT c``.
    """

    kind: str
    statement: "SelectStatement"
    all: bool = False


@dataclass(frozen=True)
class SelectStatement:
    """A parsed ``SELECT``."""

    projections: Tuple[Expression, ...]
    from_table: Optional[TableRef] = None
    joins: Tuple[JoinClause, ...] = ()
    where: Optional[Expression] = None
    group_by: Tuple[Expression, ...] = ()
    having: Optional[Expression] = None
    order_by: Tuple[SortKey, ...] = ()
    limit: Optional[int] = None
    offset: int = 0
    distinct: bool = False
    set_operation: Optional[SetOperation] = None

    @property
    def has_star(self) -> bool:
        """True when the projection list contains a bare or qualified star."""
        return any(
            isinstance(item, ColumnRef) and item.name == "*" for item in self.projections
        )

    def table_refs(self) -> List[TableRef]:
        """Every table the statement reads, in ``FROM`` order."""
        refs: List[TableRef] = []
        if self.from_table is not None:
            refs.append(self.from_table)
        refs.extend(clause.table for clause in self.joins)
        return refs

    def describe(self) -> str:
        """Render a one-line summary of the statement."""
        parts = ["SELECT"]
        if self.distinct:
            parts.append("DISTINCT")
        parts.append(", ".join(item.to_sql() for item in self.projections))
        if self.from_table is not None:
            parts.append(f"FROM {self.from_table.describe()}")
        for clause in self.joins:
            parts.append(clause.describe())
        if self.where is not None:
            parts.append(f"WHERE {self.where.to_sql()}")
        if self.group_by:
            parts.append("GROUP BY " + ", ".join(item.to_sql() for item in self.group_by))
        if self.having is not None:
            parts.append(f"HAVING {self.having.to_sql()}")
        if self.order_by:
            parts.append("ORDER BY " + ", ".join(key.describe() for key in self.order_by))
        if self.limit is not None:
            parts.append(f"LIMIT {self.limit}")
        if self.offset:
            parts.append(f"OFFSET {self.offset}")
        return " ".join(parts)


class SqlParser(ExpressionParser):
    """Parses one ``SELECT`` statement, reusing the expression grammar."""

    def parse_statement(self) -> SelectStatement:
        """Parse a complete statement.

        Raises:
            ParseError: On malformed input or unexpected trailing tokens.
            UnsupportedFeatureError: For statement kinds other than ``SELECT``.
        """
        statement = self.parse_select()
        if not self.at_end():
            raise self._unexpected(["end of statement"])
        return statement

    def parse_select(self) -> SelectStatement:
        """Parse a set-operation chain, honouring operator precedence.

        ``INTERSECT`` binds more tightly than ``UNION`` / ``EXCEPT``.  The
        latter two are left-associative.  The chain is encoded as a
        right-recursive ``set_operation`` linked list, but the compiler is
        aware that UNION/EXCEPT must be folded left.
        """
        # Parse the first INTERSECT-chain (one or more SELECTs joined by
        # INTERSECT, which binds most tightly).
        head = self._parse_intersect_chain()

        # Now handle UNION and EXCEPT at equal, lower precedence,
        # left-associative.  We collect them into a flat list and then fold
        # left by nesting right-recursively from the *inside out* — i.e. we
        # build (((a op1 b) op2 c) op3 d) which means the leftmost pair is
        # the innermost set_operation in the final structure.
        #
        # We accumulate (kind, all_flag, right_statement) tuples and then
        # build the nested chain in one pass at the end.
        tail: List[Tuple[str, bool, SelectStatement]] = []
        while True:
            if self.current.is_keyword("union"):
                self.advance()
                include_all = self.match_keyword("all")
                tail.append(("union", include_all, self._parse_intersect_chain()))
            elif self.current.is_keyword("except"):
                self.advance()
                include_all = self.match_keyword("all")
                tail.append(("except", include_all, self._parse_intersect_chain()))
            else:
                break

        if not tail:
            return head

        # Fold left: build a right-recursive linked list whose *leftmost*
        # nesting corresponds to the leftmost operation.
        #
        # For a EXCEPT b UNION c (left-assoc: (a EXCEPT b) UNION c):
        #   tail = [(except, False, b), (union, False, c)]
        #
        # We want the compiler to see:
        #   a -> SetOperation(except, b -> SetOperation(union, c))
        # and fold it as: Union(Except(a, b), c)
        #
        # The compiler must fold LEFT, walking the chain iteratively.
        # We encode this as a right-recursive list.  The compiler knows
        # UNION/EXCEPT are left-associative and folds accordingly.
        # Build the chain by appending each operation at the END of the
        # linked list.  This produces right-recursive structure that the
        # compiler's shunting-yard algorithm correctly folds left.
        result = head
        for kind, include_all, right_stmt in tail:
            result = _append_set_op(result, SetOperation(kind, right_stmt, include_all))
        return result

    def _parse_intersect_chain(self) -> SelectStatement:
        """Parse one SELECT followed by zero or more INTERSECT operands.

        INTERSECT is left-associative and higher-precedence than UNION/EXCEPT,
        so ``a INTERSECT b INTERSECT c`` is ``(a INTERSECT b) INTERSECT c``.
        We fold left immediately.
        """
        stmt = self._parse_single_select()
        while self.current.is_keyword("intersect"):
            self.advance()
            include_all = self.match_keyword("all")
            right = self._parse_single_select()
            stmt = _append_set_op(stmt, SetOperation("intersect", right, include_all))
        return stmt

    def _parse_single_select(self) -> SelectStatement:
        """Parse exactly one SELECT clause without a set operation."""
        if not self.current.is_keyword("select"):
            token = self.current
            raise UnsupportedFeatureError(
                f"only SELECT statements are supported, got {token.text or 'end of input'!r}"
            )
        self.advance()
        distinct = self.match_keyword("distinct")
        projections = self._parse_projections()
        from_table: Optional[TableRef] = None
        joins: List[JoinClause] = []
        if self.match_keyword("from"):
            from_table = self._parse_table_ref()
            joins = self._parse_joins()
        where = self.parse_expression() if self.match_keyword("where") else None
        group_by = self._parse_group_by()
        having = self.parse_expression() if self.match_keyword("having") else None
        order_by = self._parse_order_by()
        limit, offset = self._parse_limit_offset()
        if having is not None and not group_by and not _has_aggregate(having):
            raise ParseError("HAVING requires GROUP BY or an aggregate", source=self.source)
        return SelectStatement(
            projections=tuple(projections),
            from_table=from_table,
            joins=tuple(joins),
            where=where,
            group_by=tuple(group_by),
            having=having,
            order_by=tuple(order_by),
            limit=limit,
            offset=offset,
            distinct=distinct,
            set_operation=None,
        )

    # ------------------------------------------------------------------
    # Clauses
    # ------------------------------------------------------------------
    def _parse_projections(self) -> List[Expression]:
        projections: List[Expression] = [self._parse_projection_item()]
        while self.match_punctuation(","):
            projections.append(self._parse_projection_item())
        return projections

    def _parse_projection_item(self) -> Expression:
        if self.current.is_operator("*"):
            self.advance()
            return STAR
        return self.parse_aliased_expression()

    def _parse_table_ref(self) -> TableRef:
        name = self.expect_identifier()
        alias: Optional[str] = None
        if self.match_keyword("as"):
            alias = self.expect_identifier()
        elif self.current.type in (TokenType.IDENTIFIER, TokenType.QUOTED_IDENTIFIER):
            alias = self.advance().text
        return TableRef(name, alias)

    def _parse_joins(self) -> List[JoinClause]:
        joins: List[JoinClause] = []
        while True:
            token = self.current
            if token.type is not TokenType.KEYWORD:
                break
            how = join_type_for(token.text)
            if how is None:
                break
            self.advance()
            if token.text.lower() != "join":
                self.match_keyword("outer")
                self.expect_keyword("join")
            table = self._parse_table_ref()
            condition: Optional[Expression] = None
            if self.match_keyword("on"):
                condition = self.parse_expression()
            elif self.current.is_keyword("using"):
                raise UnsupportedFeatureError("JOIN ... USING")
            if how == "cross" and condition is not None:
                raise ParseError("CROSS JOIN must not have an ON clause", source=self.source)
            if how != "cross" and condition is None:
                raise ParseError(
                    f"{how.upper()} JOIN requires an ON clause", source=self.source
                )
            joins.append(JoinClause(table, condition, how))
        return joins

    def _parse_group_by(self) -> List[Expression]:
        if not self.current.is_keyword("group"):
            return []
        self.advance()
        self.expect_keyword("by")
        groups = [self.parse_expression()]
        while self.match_punctuation(","):
            groups.append(self.parse_expression())
        return groups

    def _parse_order_by(self) -> List[SortKey]:
        if not self.current.is_keyword("order"):
            return []
        self.advance()
        self.expect_keyword("by")
        keys = [self._parse_sort_key()]
        while self.match_punctuation(","):
            keys.append(self._parse_sort_key())
        return keys

    def _parse_sort_key(self) -> SortKey:
        expression = self.parse_expression()
        ascending = True
        nulls_first: Optional[bool] = None
        if self.match_keyword("desc"):
            ascending = False
        else:
            self.match_keyword("asc")
        if self.match_keyword("nulls"):
            if self.match_keyword("first"):
                nulls_first = True
            elif self.match_keyword("last"):
                nulls_first = False
            else:
                raise self._unexpected(["first", "last"])
        return SortKey(expression, ascending, nulls_first)

    def _parse_limit_offset(self) -> Tuple[Optional[int], int]:
        limit: Optional[int] = None
        offset = 0
        if self.match_keyword("limit"):
            limit = self._parse_count("LIMIT")
        if self.match_keyword("offset"):
            offset = self._parse_count("OFFSET")
        if limit is None and self.match_keyword("limit"):
            limit = self._parse_count("LIMIT")
        return limit, offset

    def _parse_count(self, clause: str) -> int:
        token = self.current
        if token.type is not TokenType.NUMBER or "." in token.text:
            raise ParseError(
                f"{clause} requires a whole number", position=token.position,
                line=token.line, column=token.column, source=self.source,
            )
        self.advance()
        value = int(token.text)
        if value < 0:
            raise ParseError(f"{clause} must not be negative", source=self.source)
        return value


def _with_set_op(stmt: SelectStatement, op: SetOperation) -> SelectStatement:
    """Return a copy of ``stmt`` with ``set_operation`` replaced by ``op``."""
    return SelectStatement(
        projections=stmt.projections,
        from_table=stmt.from_table,
        joins=stmt.joins,
        where=stmt.where,
        group_by=stmt.group_by,
        having=stmt.having,
        order_by=stmt.order_by,
        limit=stmt.limit,
        offset=stmt.offset,
        distinct=stmt.distinct,
        set_operation=op,
    )


def _append_set_op(stmt: SelectStatement, op: SetOperation) -> SelectStatement:
    """Append ``op`` at the END of ``stmt``'s set_operation linked list.

    For ``stmt`` with no set_operation, this is the same as ``_with_set_op``.
    For a stmt that already has a chain, the new operation is appended after
    the last element, preserving the existing chain.

    Example::

        a -> (except, b)
        _append_set_op(a_chain, SetOperation("union", c))
        => a -> (except, b -> (union, c))
    """
    if stmt.set_operation is None:
        return _with_set_op(stmt, op)
    # Recursively append at the end of the right side's chain.
    updated_right = _append_set_op(stmt.set_operation.statement, op)
    new_inner_op = SetOperation(
        stmt.set_operation.kind, updated_right, stmt.set_operation.all
    )
    return _with_set_op(stmt, new_inner_op)


def _has_aggregate(expression: Expression) -> bool:
    """True when an expression contains an aggregate call."""
    from ..expr.ast import contains_aggregate

    return contains_aggregate(expression)


def parse_select(source: str) -> SelectStatement:
    """Parse one ``SELECT`` statement from text."""
    tokens = strip_terminator(lex(source))
    return SqlParser(tokens, source).parse_statement()
