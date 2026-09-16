"""Grouped and ungrouped aggregation."""

from __future__ import annotations

from typing import Any, Iterator, Sequence

from ...plan.expressions import AggregateCall
from ...plan.logical import NamedExpr
from ...types.schema import Field, Schema
from ..aggregators import AggregateSpec, GroupState, build_specs
from ..batch import RecordBatch, batches_from_rows
from ..context import ExecutionContext
from ..evaluator import ExpressionEvaluator
from ..keys import row_key
from .base import Operator, UnaryOperator

__all__ = ["AggregateOperator"]


class AggregateOperator(UnaryOperator):
    """Groups rows by the group keys and folds each group's aggregates.

    Groups are emitted in first-appearance order, which makes results stable
    without forcing a sort.  An ungrouped aggregate over an empty input still
    produces exactly one row, so ``SELECT COUNT(*) FROM empty`` returns 0
    rather than no rows at all.
    """

    def __init__(
        self,
        child: Operator,
        group_by: Sequence[NamedExpr],
        aggregates: Sequence[NamedExpr],
    ) -> None:
        super().__init__(child)
        self._group_by = tuple(group_by)
        self._aggregates = tuple(aggregates)
        self._schema = Schema(
            Field(name=item.name, dtype=item.expression.dtype)
            for item in (*self._group_by, *self._aggregates)
        )

    @property
    def schema(self) -> Schema:
        return self._schema

    @property
    def is_global(self) -> bool:
        return not self._group_by

    def describe(self) -> str:
        groups = ", ".join(item.describe() for item in self._group_by)
        aggs = ", ".join(item.describe() for item in self._aggregates)
        if groups:
            return f"HashAggregate groups=[{groups}] aggs=[{aggs}]"
        return f"Aggregate aggs=[{aggs}]"

    def execute(self, context: ExecutionContext) -> Iterator[RecordBatch]:
        evaluator = ExpressionEvaluator(
            context.registry,
            strict_casts=context.strict_casts,
            context=context,
        )
        input_schema = self.child.schema
        group_functions = evaluator.compile_all(
            [item.expression for item in self._group_by], input_schema
        )
        specs = build_specs(
            [
                (item.name, _as_call(item))
                for item in self._aggregates
            ],
            input_schema,
            context.registry,
            strict_casts=context.strict_casts,
            context=context,
        )

        groups: dict[tuple, GroupState] = {}
        order: list[tuple] = []
        saw_input = False

        for batch in self.child.execute(context):
            for row in batch.rows:
                saw_input = True
                key_values = [function(row) for function in group_functions]
                key = row_key(key_values)
                state = groups.get(key)
                if state is None:
                    state = GroupState(specs, tuple(key_values))
                    groups[key] = state
                    order.append(key)
                    context.metrics.groups_created += 1
                state.update(specs, row)

        rows = self._build_rows(groups, order, specs, saw_input, context)
        if not rows:
            return
        for batch in batches_from_rows(self._schema, rows, context.batch_size):
            context.metrics.record_batch(len(batch))
            yield batch

    def _build_rows(
        self,
        groups: dict[tuple, GroupState],
        order: Sequence[tuple],
        specs: Sequence[AggregateSpec],
        saw_input: bool,
        context: ExecutionContext,
    ) -> list[list[Any]]:
        if not order:
            if self.is_global and not saw_input:
                empty = GroupState(specs, ())
                context.metrics.groups_created += 1
                return [list(empty.results())]
            return []
        rows: list[list[Any]] = []
        for key in order:
            state = groups[key]
            rows.append([*state.key, *state.results()])
        return rows


def _as_call(item: NamedExpr) -> AggregateCall:
    expression = item.expression
    if not isinstance(expression, AggregateCall):  # pragma: no cover - defensive
        raise TypeError(
            f"aggregate output {item.name!r} is not an aggregate call"
        )
    return expression
