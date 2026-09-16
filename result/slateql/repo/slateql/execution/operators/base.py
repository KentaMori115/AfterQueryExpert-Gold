"""The physical operator interface.

Operators form a pull-based tree: calling :meth:`Operator.execute` returns a
generator of :class:`~slateql.execution.batch.RecordBatch` objects, and pulling
from it pulls from the children in turn.  Nothing is executed until the
consumer starts iterating, which is what lets LIMIT stop a scan early.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Iterator, Sequence

from ...types.schema import Schema
from ..batch import RecordBatch
from ..context import ExecutionContext

__all__ = ["Operator", "UnaryOperator", "BinaryOperator", "LeafOperator"]


class Operator(ABC):
    """Base class for every physical operator."""

    @property
    @abstractmethod
    def schema(self) -> Schema:
        """The columns this operator emits."""

    @abstractmethod
    def execute(self, context: ExecutionContext) -> Iterator[RecordBatch]:
        """Yield non-empty batches of output rows."""

    def children(self) -> Sequence["Operator"]:
        return ()

    @property
    def name(self) -> str:
        return type(self).__name__.removesuffix("Operator")

    def describe(self) -> str:
        """One-line summary shown by EXPLAIN on the physical plan."""

        return self.name

    def walk(self) -> Iterator["Operator"]:
        yield self
        for child in self.children():
            yield from child.walk()

    def emit(
        self, context: ExecutionContext, rows: list[list[object]]
    ) -> Iterator[RecordBatch]:
        """Yield ``rows`` as one batch, skipping the call when it is empty."""

        if not rows:
            return
        context.metrics.record_batch(len(rows))
        yield RecordBatch(schema=self.schema, rows=rows)

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"{type(self).__name__}()"


class LeafOperator(Operator):
    """An operator with no inputs."""

    def children(self) -> Sequence[Operator]:
        return ()


class UnaryOperator(Operator):
    """An operator with exactly one input."""

    def __init__(self, child: Operator) -> None:
        self._child = child

    @property
    def child(self) -> Operator:
        return self._child

    def children(self) -> Sequence[Operator]:
        return (self._child,)

    @property
    def schema(self) -> Schema:
        return self._child.schema


class BinaryOperator(Operator):
    """An operator with a left and a right input."""

    def __init__(self, left: Operator, right: Operator) -> None:
        self._left = left
        self._right = right

    @property
    def left(self) -> Operator:
        return self._left

    @property
    def right(self) -> Operator:
        return self._right

    def children(self) -> Sequence[Operator]:
        return (self._left, self._right)
