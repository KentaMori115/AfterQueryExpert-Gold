"""The hash aggregation operator.

Rows are bucketed by their grouping key and folded into one accumulator per
aggregate. Groups are emitted in first-seen order, which makes results stable
across runs without paying for a sort.

The operator only understands aggregate calls, not expressions built around
them: ``SUM(x) + 1`` is compiled as an aggregation producing ``SUM(x)``, with a
projection above it doing the arithmetic. Keeping that split means the operator
never has to re-enter the expression evaluator with partially aggregated state.
"""

from __future__ import annotations

from typing import Any, Dict, Iterator, List, Optional, Sequence, Tuple

from ...core.batch import RecordBatch
from ...core.column import Column
from ...errors import PlanningError
from ...expr.aggregates import Accumulator
from ...expr.ast import AggregateCall, Alias, Expression
from ...types.schema import Schema
from ...utils.hashing import value_key
from ..context import ExecutionContext
from .base import Operator, UnaryOperator

__all__ = ["HashAggregateOperator", "unwrap_aggregate"]


def unwrap_aggregate(expression: Expression) -> AggregateCall:
    """Return the aggregate call inside an expression.

    Raises:
        PlanningError: If the expression is not an aggregate call, optionally
            wrapped in a single alias.
    """
    inner = expression.child if isinstance(expression, Alias) else expression
    if not isinstance(inner, AggregateCall):
        raise PlanningError(
            f"aggregation expects aggregate calls, got {expression.to_sql()}"
        )
    return inner


class HashAggregateOperator(UnaryOperator):
    """Groups rows and folds each group through a set of accumulators."""

    def __init__(
        self,
        child: Operator,
        group_by: Sequence[Expression],
        aggregates: Sequence[Expression],
        schema: Schema,
    ) -> None:
        super().__init__(child)
        self.group_by = tuple(group_by)
        self.aggregates = tuple(aggregates)
        self.calls = tuple(unwrap_aggregate(item) for item in self.aggregates)
        self._schema = schema

    @property
    def schema(self) -> Schema:
        return self._schema

    @property
    def is_blocking(self) -> bool:
        return True

    @property
    def is_global(self) -> bool:
        """True when there are no grouping keys."""
        return not self.group_by

    def _execute(self, context: ExecutionContext) -> Iterator[RecordBatch]:
        evaluator = context.evaluator
        groups: Dict[tuple, List[Accumulator]] = {}
        representatives: Dict[tuple, List[Any]] = {}
        seen_distinct: Dict[tuple, List[set]] = {}
        order: List[tuple] = []
        input_schema = self.child.schema

        for batch in self.child.execute(context):
            key_columns = [
                evaluator.evaluate(expression, batch) for expression in self.group_by
            ]
            argument_columns = [
                [evaluator.evaluate(argument, batch) for argument in call.args]
                for call in self.calls
            ]
            for row in range(batch.num_rows):
                key_values = [column[row] for column in key_columns]
                key = tuple(value_key(value) for value in key_values)
                accumulators = groups.get(key)
                if accumulators is None:
                    accumulators = self._new_accumulators(input_schema, context)
                    groups[key] = accumulators
                    representatives[key] = key_values
                    seen_distinct[key] = [set() for _ in self.calls]
                    order.append(key)
                self._update(key, row, accumulators, argument_columns, seen_distinct[key])

        if not order and self.is_global:
            # A global aggregation over no rows still produces exactly one row.
            order.append(())
            groups[()] = self._new_accumulators(input_schema, context)
            representatives[()] = []

        context.metrics.increment("aggregate.groups", len(order))
        rows: List[tuple] = []
        for key in order:
            values = list(representatives[key])
            values.extend(item.finalize() for item in groups[key])
            rows.append(tuple(values))
            if len(rows) >= context.batch_size:
                yield RecordBatch.from_rows(self._schema, rows)
                rows = []
        if rows:
            yield RecordBatch.from_rows(self._schema, rows)

    def _new_accumulators(
        self, input_schema: Schema, context: ExecutionContext
    ) -> List[Accumulator]:
        """Build one fresh accumulator per aggregate expression."""
        from ...expr.resolver import ExpressionResolver

        resolver = ExpressionResolver(context.functions, context.aggregates)
        created: List[Accumulator] = []
        for call in self.calls:
            arg_types = [
                resolver.resolve(argument, input_schema) for argument in call.args
            ]
            created.append(context.aggregates.get(call.name).create(arg_types))
        return created

    def _update(
        self,
        key: tuple,
        row: int,
        accumulators: Sequence[Accumulator],
        argument_columns: Sequence[Sequence[Column]],
        distinct_seen: Sequence[set],
    ) -> None:
        """Fold one input row into a group's accumulators."""
        for index, call in enumerate(self.calls):
            columns = argument_columns[index]
            if not columns:
                # COUNT(*) counts rows, so the value handed over is irrelevant.
                accumulators[index].update(None)
                continue
            value = columns[0][row]
            if call.distinct:
                marker = value_key(value)
                if marker in distinct_seen[index]:
                    continue
                distinct_seen[index].add(marker)
            accumulators[index].update(value)

    def describe(self) -> str:
        groups = ", ".join(item.to_sql() for item in self.group_by) or "()"
        aggs = ", ".join(item.to_sql() for item in self.aggregates) or "()"
        return f"HashAggregate(groupBy={groups}, aggregates={aggs})"
