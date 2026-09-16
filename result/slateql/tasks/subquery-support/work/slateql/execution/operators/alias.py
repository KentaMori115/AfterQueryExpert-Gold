"""Relation aliasing for derived tables."""

from __future__ import annotations

from typing import Iterator

from ...types.schema import Schema
from ..batch import RecordBatch
from ..context import ExecutionContext
from .base import Operator, UnaryOperator

__all__ = ["AliasOperator"]


class AliasOperator(UnaryOperator):
    """Re-labels the input's columns under one relation alias.

    Rows pass through untouched and in order; only the schema's qualifiers
    change, which is what lets ``FROM (SELECT ...) AS d`` be joined and
    filtered like a base table.
    """

    def __init__(self, child: Operator, alias: str) -> None:
        super().__init__(child)
        self._alias = alias
        self._schema = child.schema.qualified(alias)

    @property
    def schema(self) -> Schema:
        return self._schema

    @property
    def alias(self) -> str:
        return self._alias

    def describe(self) -> str:
        return f"Alias {self._alias}"

    def execute(self, context: ExecutionContext) -> Iterator[RecordBatch]:
        schema = self._schema
        for batch in self.child.execute(context):
            yield RecordBatch(schema=schema, rows=batch.rows)
