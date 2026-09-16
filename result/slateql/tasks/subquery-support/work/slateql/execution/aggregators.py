"""Runtime aggregate machinery.

An :class:`AggregateSpec` bundles everything the aggregate operator needs for
one output column: how to compute its arguments for a row, whether DISTINCT
applies, and how to make a fresh accumulator for a new group.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional, Sequence

from ..errors import ExecutionError
from ..functions.registry import FunctionRegistry
from ..functions.signature import Accumulator
from ..plan.expressions import AggregateCall
from ..types.schema import Schema
from .context import ExecutionContext
from .evaluator import ExpressionEvaluator, RowFunction

__all__ = ["AggregateSpec", "GroupState", "build_specs"]


@dataclass
class AggregateSpec:
    """One aggregate output column, prepared for execution."""

    name: str
    call: AggregateCall
    argument_functions: tuple[RowFunction, ...]
    factory: Any
    distinct: bool

    def evaluate_arguments(self, row: Sequence[Any]) -> tuple[Any, ...]:
        return tuple(function(row) for function in self.argument_functions)

    def new_accumulator(self) -> Accumulator:
        return self.factory()


class GroupState:
    """Accumulator set for a single group key."""

    __slots__ = ("accumulators", "seen", "key")

    def __init__(self, specs: Sequence[AggregateSpec], key: tuple) -> None:
        self.key = key
        self.accumulators = [spec.new_accumulator() for spec in specs]
        self.seen: list[Optional[set]] = [
            set() if spec.distinct else None for spec in specs
        ]

    def update(self, specs: Sequence[AggregateSpec], row: Sequence[Any]) -> None:
        """Fold ``row`` into every accumulator, honouring DISTINCT."""

        for index, spec in enumerate(specs):
            values = spec.evaluate_arguments(row)
            tracker = self.seen[index]
            if tracker is not None:
                if values in tracker:
                    continue
                tracker.add(values)
            self.accumulators[index].update(values)

    def results(self) -> list[Any]:
        return [accumulator.result() for accumulator in self.accumulators]


def build_specs(
    calls: Sequence[tuple[str, AggregateCall]],
    schema: Schema,
    registry: FunctionRegistry,
    *,
    strict_casts: bool = False,
    context: Optional[ExecutionContext] = None,
) -> list[AggregateSpec]:
    """Prepare :class:`AggregateSpec` objects for the aggregate operator."""

    evaluator = ExpressionEvaluator(
        registry, strict_casts=strict_casts, context=context
    )
    specs: list[AggregateSpec] = []
    for name, call in calls:
        definition = registry.aggregate(call.name)
        if call.distinct:
            definition.require_distinct_supported()
        arg_types = [arg.dtype for arg in call.args]
        try:
            functions = tuple(
                evaluator.compile(argument, schema) for argument in call.args
            )
        except ExecutionError as exc:  # pragma: no cover - defensive
            raise ExecutionError(
                f"cannot prepare aggregate {call.to_sql()}: {exc}"
            ) from exc
        specs.append(
            AggregateSpec(
                name=name,
                call=call,
                argument_functions=functions,
                factory=lambda definition=definition, arg_types=arg_types: (
                    definition.create(arg_types)
                ),
                distinct=call.distinct,
            )
        )
    return specs
