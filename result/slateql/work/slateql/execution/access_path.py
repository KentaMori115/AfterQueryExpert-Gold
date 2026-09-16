"""Choosing how a scan finds its rows.

A scan reads a table from the front unless an index can answer the predicates
the optimizer pushed into it, or supply the order a sort above it wants.  This
module inspects those pushed conjuncts, decides which single index to use, and
hands back the conjuncts the index cannot answer so the operator still applies
them.

Nothing here changes what a scan produces.  An index narrows the rows that get
read; every row it hands back is a row a full scan would have handed back too,
in the position the table put it.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional, Sequence

from ..plan import expressions as X
from ..plan.logical import Scan
from ..storage.table import Index, Table
from ..util.ordering import compare_values

__all__ = [
    "AccessPath",
    "LookupPath",
    "RangePath",
    "OrderedPath",
    "OrderRequest",
    "choose_access_path",
]

_RANGE_OPS = frozenset({"<", "<=", ">", ">="})
#: How a comparison reads once the column is on its left.
_FLIPPED = {"<": ">", "<=": ">=", ">": "<", ">=": "<="}


@dataclass(frozen=True)
class OrderRequest:
    """The single sort key a scan could be asked to produce directly."""

    column: str
    descending: bool = False
    nulls_first: bool = False


@dataclass(frozen=True)
class AccessPath:
    """An index and the way a scan will walk it."""

    index: Index
    column: str

    def offsets(self) -> list[int]:  # pragma: no cover - overridden everywhere
        raise NotImplementedError

    def describe(self) -> str:  # pragma: no cover - overridden everywhere
        raise NotImplementedError


@dataclass(frozen=True)
class LookupPath(AccessPath):
    """Rows found by key: one equality, an ``IN`` list, or ``IS NULL``.

    Keys are looked up one at a time, so the index reports its offsets grouped
    by key.  They are sorted before use: a lookup finds rows, it does not
    reorder the table.
    """

    keys: tuple[Any, ...] = ()
    nulls: bool = False

    def offsets(self) -> list[int]:
        if self.nulls:
            return sorted(self.index.null_offsets())
        if not self.keys:
            return []
        finder = getattr(self.index, "lookup_any", None)
        found = finder(self.keys) if finder else self.index.equal_any(self.keys)
        return sorted(found)

    def describe(self) -> str:
        if self.nulls:
            return f"lookup {self.column} IS NULL"
        return f"lookup {self.column} in {len(self.keys)} key(s)"


@dataclass(frozen=True)
class RangePath(AccessPath):
    """Rows found between bounds, folded from every range conjunct on one column."""

    low: Any = None
    high: Any = None
    include_low: bool = True
    include_high: bool = True
    empty: bool = False

    def offsets(self) -> list[int]:
        if self.empty:
            return []
        return sorted(
            self.index.range(
                low=self.low,
                high=self.high,
                include_low=self.include_low,
                include_high=self.include_high,
            )
        )

    def describe(self) -> str:
        left = "[" if self.include_low else "("
        right = "]" if self.include_high else ")"
        return f"range {self.column} {left}{self.low!r}, {self.high!r}{right}"


@dataclass(frozen=True)
class OrderedPath(AccessPath):
    """Every row, walked in key order, so the sort above can be dropped."""

    descending: bool = False
    nulls_first: bool = False

    def offsets(self) -> list[int]:
        return self.index.in_key_order(
            descending=self.descending, nulls_first=self.nulls_first
        )

    def describe(self) -> str:
        direction = "desc" if self.descending else "asc"
        placement = "nulls first" if self.nulls_first else "nulls last"
        return f"ordered {self.column} {direction} {placement}"


def _is_column(expression: X.Expr, column: str, alias: str) -> bool:
    """Whether ``expression`` names ``column`` of the relation being scanned."""

    return (
        isinstance(expression, X.Column)
        and expression.name == column
        and expression.qualifier in (None, alias)
    )


def _literal(expression: X.Expr) -> tuple[bool, Any]:
    """``(True, value)`` when ``expression`` is a constant the index can use."""

    if isinstance(expression, X.Literal):
        return True, expression.value
    return False, None


def _equality_key(conjunct: X.Expr, column: str, alias: str) -> tuple[bool, Any]:
    """Recognise ``col = <literal>`` written from either side."""

    if not isinstance(conjunct, X.BinaryExpr) or conjunct.op != "=":
        return False, None
    if _is_column(conjunct.left, column, alias):
        return _literal(conjunct.right)
    if _is_column(conjunct.right, column, alias):
        return _literal(conjunct.left)
    return False, None


def _in_keys(conjunct: X.Expr, column: str, alias: str) -> tuple[bool, tuple[Any, ...]]:
    """Recognise ``col IN (<literals>)``.

    A null in the list matches nothing, so it is dropped rather than looked
    up, and a list of nothing but nulls leaves no keys at all.
    """

    if not isinstance(conjunct, X.InList) or conjunct.negated:
        return False, ()
    if not _is_column(conjunct.operand, column, alias):
        return False, ()
    keys: list[Any] = []
    for item in conjunct.items:
        ok, value = _literal(item)
        if not ok:
            return False, ()
        if value is not None:
            keys.append(value)
    return True, tuple(keys)


def _is_null_test(conjunct: X.Expr, column: str, alias: str) -> bool:
    return (
        isinstance(conjunct, X.IsNull)
        and not conjunct.negated
        and _is_column(conjunct.operand, column, alias)
    )


def _range_bound(conjunct: X.Expr, column: str, alias: str) -> Optional[tuple[str, Any]]:
    """Recognise a comparison and report it with the column on the left."""

    if not isinstance(conjunct, X.BinaryExpr) or conjunct.op not in _RANGE_OPS:
        return None
    if _is_column(conjunct.left, column, alias):
        ok, value = _literal(conjunct.right)
        return (conjunct.op, value) if ok else None
    if _is_column(conjunct.right, column, alias):
        ok, value = _literal(conjunct.left)
        return (_FLIPPED[conjunct.op], value) if ok else None
    return None


def _fold_bounds(bounds: Sequence[tuple[str, Any]]) -> dict[str, Any]:
    """Intersect every comparison on one column into a single interval.

    A bound of NULL is not a bound: comparing with NULL is unknown, and WHERE
    keeps only rows that are exactly TRUE, so such a predicate matches nothing
    at all.
    """

    folded: dict[str, Any] = {
        "low": None,
        "high": None,
        "include_low": True,
        "include_high": True,
        "empty": False,
    }
    for op, value in bounds:
        if value is None:
            folded["empty"] = True
            continue
        if op in (">", ">="):
            inclusive = op == ">="
            if folded["low"] is None:
                folded["low"], folded["include_low"] = value, inclusive
                continue
            order = compare_values(value, folded["low"])
            if order > 0:
                folded["low"], folded["include_low"] = value, inclusive
            elif order == 0 and not inclusive:
                folded["include_low"] = False
        else:
            inclusive = op == "<="
            if folded["high"] is None:
                folded["high"], folded["include_high"] = value, inclusive
                continue
            order = compare_values(value, folded["high"])
            if order < 0:
                folded["high"], folded["include_high"] = value, inclusive
            elif order == 0 and not inclusive:
                folded["include_high"] = False
    return folded


def _lookup_for(
    index: Index, column: str, alias: str, conjuncts: Sequence[X.Expr]
) -> Optional[tuple[LookupPath, int]]:
    """The first key lookup this index can answer, and which conjunct it uses."""

    for position, conjunct in enumerate(conjuncts):
        ok, value = _equality_key(conjunct, column, alias)
        if ok:
            keys = () if value is None else (value,)
            return LookupPath(index=index, column=column, keys=keys), position
        ok, keys = _in_keys(conjunct, column, alias)
        if ok:
            return LookupPath(index=index, column=column, keys=keys), position
        if index.kind == "hash" and _is_null_test(conjunct, column, alias):
            return LookupPath(index=index, column=column, nulls=True), position
    return None


def _range_for(
    index: Index, column: str, alias: str, conjuncts: Sequence[X.Expr]
) -> Optional[tuple[RangePath, list[int]]]:
    """The interval this sorted index can answer, and which conjuncts it uses."""

    if index.kind != "sorted":
        return None
    bounds: list[tuple[str, Any]] = []
    used: list[int] = []
    for position, conjunct in enumerate(conjuncts):
        bound = _range_bound(conjunct, column, alias)
        if bound is not None:
            bounds.append(bound)
            used.append(position)
    if not bounds:
        return None
    folded = _fold_bounds(bounds)
    return RangePath(index=index, column=column, **folded), used


def choose_access_path(
    table: Table, scan: Scan, order: Optional[OrderRequest] = None
) -> tuple[Optional[AccessPath], tuple[X.Expr, ...]]:
    """Pick at most one index for ``scan`` and report what it cannot answer.

    A key lookup is worth more than a range and a range more than an ordered
    read, because a lookup usually touches fewest rows.  Within one rank the
    table's own schema order decides, so the choice never depends on the order
    predicates happen to be written in.
    """

    conjuncts = list(scan.pushed_filters)
    columns = table.indexed_columns()
    if not columns:
        return None, tuple(conjuncts)

    for column in columns:
        index = table.index_for(column)
        found = _lookup_for(index, column, scan.alias, conjuncts)
        if found is not None:
            path, position = found
            residual = [c for i, c in enumerate(conjuncts) if i != position]
            return path, tuple(residual)

    for column in columns:
        index = table.index_for(column)
        found = _range_for(index, column, scan.alias, conjuncts)
        if found is not None:
            path, used = found
            residual = [c for i, c in enumerate(conjuncts) if i not in set(used)]
            return path, tuple(residual)

    if order is not None:
        index = table.index_for(order.column)
        if index is not None and index.kind == "sorted":
            path = OrderedPath(
                index=index,
                column=order.column,
                descending=order.descending,
                nulls_first=order.nulls_first,
            )
            return path, tuple(conjuncts)

    return None, tuple(conjuncts)
