"""The value returned by :meth:`slateql.session.Session.sql`."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterator, Optional, Sequence

from .errors import SlateQLError
from .types.schema import Schema
from .util.table_render import render_table

__all__ = ["QueryResult"]


@dataclass(frozen=True)
class QueryResult:
    """A fully materialised result set.

    Results are eager: by the time a ``QueryResult`` exists the query has run
    to completion.  That makes the object safe to keep, iterate repeatedly, and
    compare in tests.
    """

    schema: Schema
    rows: list[list[Any]]
    statement: str = ""
    metrics: dict[str, int] = field(default_factory=dict)

    # -- shape -----------------------------------------------------------

    def __len__(self) -> int:
        return len(self.rows)

    def __iter__(self) -> Iterator[list[Any]]:
        return iter(self.rows)

    def __getitem__(self, index: int) -> list[Any]:
        return self.rows[index]

    @property
    def columns(self) -> list[str]:
        return self.schema.names

    @property
    def is_empty(self) -> bool:
        return not self.rows

    # -- conversions -----------------------------------------------------

    def to_dicts(self) -> list[dict[str, Any]]:
        """Rows as dictionaries keyed by column name."""

        names = self.schema.names
        return [dict(zip(names, row)) for row in self.rows]

    def to_tuples(self) -> list[tuple]:
        return [tuple(row) for row in self.rows]

    def column(self, name: str) -> list[Any]:
        """All values of one column, looked up by name."""

        index = self.schema.index_of(name)
        return [row[index] for row in self.rows]

    def scalar(self) -> Any:
        """The single value of a one-row, one-column result."""

        if len(self.rows) != 1 or len(self.schema) != 1:
            raise SlateQLError(
                "scalar() requires exactly one row and one column, got "
                f"{len(self.rows)} rows and {len(self.schema)} columns"
            )
        return self.rows[0][0]

    def first(self) -> Optional[list[Any]]:
        return self.rows[0] if self.rows else None

    # -- rendering -------------------------------------------------------

    def pretty(self, *, max_rows: Optional[int] = None, max_width: int = 40) -> str:
        """Render the result as an ASCII table."""

        return render_table(
            self.schema.names,
            self.rows,
            max_rows=max_rows,
            max_width=max_width,
        )

    def describe_schema(self) -> str:
        return self.schema.describe()

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"QueryResult(columns={self.schema.names}, rows={len(self.rows)})"


def result_from_batches(
    schema: Schema,
    batches: Sequence[Any],
    statement: str = "",
    metrics: Optional[dict[str, int]] = None,
) -> QueryResult:
    """Concatenate batches into a single :class:`QueryResult`."""

    rows: list[list[Any]] = []
    for batch in batches:
        rows.extend(batch.rows)
    return QueryResult(
        schema=schema,
        rows=rows,
        statement=statement,
        metrics=dict(metrics or {}),
    )
