"""The physical operator interface.

Operators form a pull-based tree: calling :meth:`Operator.execute` returns an
iterator, and pulling from it pulls from the children in turn. Nothing is
computed until the top of the tree is iterated.

Operators divide into two kinds:

*streaming*
    Emit each input batch as soon as it has been processed: scan, filter,
    project, limit, union.

*blocking*
    Must see the whole input before emitting anything: sort, aggregate, the
    build side of a join, and the right side of an intersect or an except.

:attr:`Operator.is_blocking` reports which a given operator is, and the plan
printer surfaces it, because a blocking operator is where memory goes.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Iterator, List, Optional, Sequence, Tuple

from ...core.batch import RecordBatch
from ...core.table import Table
from ...types.schema import Schema
from ..context import ExecutionContext

__all__ = ["Operator", "UnaryOperator", "BinaryOperator"]


class Operator(ABC):
    """Base class for every physical operator."""

    @property
    @abstractmethod
    def schema(self) -> Schema:
        """The schema of the batches this operator emits."""

    @abstractmethod
    def _execute(self, context: ExecutionContext) -> Iterator[RecordBatch]:
        """Produce batches. Subclasses implement this rather than ``execute``."""

    def children(self) -> Tuple["Operator", ...]:
        """The operator's inputs."""
        return ()

    @property
    def name(self) -> str:
        """Short name used in plan output and metric keys."""
        return type(self).__name__

    @property
    def is_blocking(self) -> bool:
        """True when the operator must buffer its whole input."""
        return False

    def execute(self, context: ExecutionContext) -> Iterator[RecordBatch]:
        """Run the operator, recording metrics for what it produced.

        Empty batches are dropped here rather than in each operator, so
        downstream code never has to guard against a zero-row batch.
        """
        with context.tracer.span(self.name):
            with context.metrics.timer(f"{self.name}.elapsed"):
                for batch in self._execute(context):
                    if batch.num_rows == 0:
                        continue
                    context.metrics.increment(f"{self.name}.batches")
                    context.metrics.increment(f"{self.name}.rows", batch.num_rows)
                    yield batch

    def collect(self, context: ExecutionContext) -> Table:
        """Run the operator and materialise every batch into a table."""
        return Table(self.schema, list(self.execute(context)))

    def describe(self) -> str:
        """One-line description used by the plan printer."""
        return self.name

    def walk(self) -> Iterator["Operator"]:
        """Yield this operator and every descendant, parents first."""
        yield self
        for child in self.children():
            yield from child.walk()

    def __str__(self) -> str:
        from ...plan.printer import format_plan

        return format_plan(self)

    def __repr__(self) -> str:
        return f"<{self.describe()}>"


class UnaryOperator(Operator):
    """Convenience base for operators with exactly one input."""

    def __init__(self, child: Operator) -> None:
        self.child = child

    @property
    def schema(self) -> Schema:
        return self.child.schema

    def children(self) -> Tuple[Operator, ...]:
        return (self.child,)


class BinaryOperator(Operator):
    """Convenience base for operators with exactly two inputs."""

    def __init__(self, left: Operator, right: Operator) -> None:
        self.left = left
        self.right = right

    def children(self) -> Tuple[Operator, ...]:
        return (self.left, self.right)
