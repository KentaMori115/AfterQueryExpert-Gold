"""Aggregate extraction and rewriting.

After the FROM/WHERE clauses are bound, an aggregating query needs its select
list, HAVING clause and ORDER BY keys rewritten so that they read from the
:class:`~slateql.plan.logical.Aggregate` node's output instead of from the raw
input rows.  :class:`AggregateRewriter` performs both halves of that job: it
collects the distinct aggregate calls, and it substitutes group keys and
aggregate calls with references to the aggregate's output columns.
"""

from __future__ import annotations

from typing import Optional

from ..errors import BindingError
from ..plan.expressions import AggregateCall, Column, Expr
from ..plan.logical import NamedExpr

__all__ = ["AggregateRewriter"]


class AggregateRewriter:
    """Maps group keys and aggregate calls onto aggregate output columns."""

    def __init__(self) -> None:
        self._group_keys: list[NamedExpr] = []
        self._group_lookup: dict[Expr, Column] = {}
        self._aggregates: list[NamedExpr] = []
        self._aggregate_lookup: dict[AggregateCall, Column] = {}
        self._used_names: set[str] = set()

    # -- registration ----------------------------------------------------

    def add_group_key(self, expression: Expr, name: str) -> Column:
        """Register a GROUP BY key and return the column that replaces it."""

        existing = self._group_lookup.get(expression)
        if existing is not None:
            return existing
        unique = self._unique_name(name)
        reference = Column(name=unique, dtype=expression.dtype)
        self._group_keys.append(NamedExpr(expression=expression, name=unique))
        self._group_lookup[expression] = reference
        return reference

    def add_aggregate(self, call: AggregateCall) -> Column:
        """Register an aggregate call, de-duplicating identical calls."""

        existing = self._aggregate_lookup.get(call)
        if existing is not None:
            return existing
        unique = self._unique_name(call.output_name())
        reference = Column(name=unique, dtype=call.dtype)
        self._aggregates.append(NamedExpr(expression=call, name=unique))
        self._aggregate_lookup[call] = reference
        return reference

    def _unique_name(self, name: str) -> str:
        candidate = name
        suffix = 2
        while candidate in self._used_names:
            candidate = f"{name}#{suffix}"
            suffix += 1
        self._used_names.add(candidate)
        return candidate

    # -- rewriting -------------------------------------------------------

    def rewrite(self, expression: Expr, *, clause: str) -> Expr:
        """Replace group keys and aggregates inside ``expression``.

        The traversal is bottom-up, so a group key of ``a`` inside the larger
        expression ``a + 1`` is substituted first and the surrounding
        arithmetic is preserved, which is exactly SQL's rule.
        """

        def _substitute(node: Expr) -> Expr:
            replacement = self._group_lookup.get(node)
            if replacement is not None:
                return replacement
            if isinstance(node, AggregateCall):
                return self.add_aggregate(node)
            return node

        rewritten = expression.transform(_substitute)
        self._check_fully_grouped(rewritten, clause=clause)
        return rewritten

    def _check_fully_grouped(self, expression: Expr, *, clause: str) -> None:
        """Reject references to input columns that survived the rewrite."""

        for node in expression.walk():
            if not isinstance(node, Column):
                continue
            if node.qualifier is None and node.name in self._used_names:
                continue
            raise BindingError(
                f"column {node.qualified_name!r} must appear in the GROUP BY "
                f"clause or be used inside an aggregate function",
                hint=f"referenced from the {clause} clause",
            )

    # -- results ---------------------------------------------------------

    @property
    def group_keys(self) -> tuple[NamedExpr, ...]:
        return tuple(self._group_keys)

    @property
    def aggregates(self) -> tuple[NamedExpr, ...]:
        return tuple(self._aggregates)

    @property
    def has_aggregates(self) -> bool:
        return bool(self._aggregates)

    def output_names(self) -> list[str]:
        return [item.name for item in (*self._group_keys, *self._aggregates)]

    def lookup_group(self, expression: Expr) -> Optional[Column]:
        return self._group_lookup.get(expression)
