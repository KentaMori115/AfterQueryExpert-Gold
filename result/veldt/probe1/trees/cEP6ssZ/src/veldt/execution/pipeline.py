"""Running a plan end to end.

The pipeline glues the pieces together: optimize the logical plan, translate it
into operators, pull every batch, and package the result with the metrics that
were gathered on the way.
"""

from __future__ import annotations

from typing import Iterator, List, Optional

from ..core.batch import RecordBatch
from ..core.result import QueryResult
from ..core.table import Table
from ..plan.logical import LogicalPlan
from ..plan.optimizer import Optimizer, default_optimizer
from .context import ExecutionContext
from .operators.base import Operator
from .physical import create_physical_plan

__all__ = ["execute_plan", "execute_operator", "stream_plan", "collect"]


def execute_operator(operator: Operator, context: ExecutionContext) -> Table:
    """Pull every batch from an operator tree into a table."""
    return Table(operator.schema, list(operator.execute(context)))


def collect(operator: Operator, context: Optional[ExecutionContext] = None) -> Table:
    """Convenience wrapper around :func:`execute_operator`."""
    return execute_operator(operator, context or ExecutionContext())


def stream_plan(
    plan: LogicalPlan,
    context: Optional[ExecutionContext] = None,
    optimizer: Optional[Optimizer] = None,
) -> Iterator[RecordBatch]:
    """Optimize and run a plan, yielding batches as they are produced."""
    active = context or ExecutionContext()
    rewritten = (optimizer or default_optimizer()).optimize(plan) if optimizer is not False else plan
    operator = create_physical_plan(rewritten, active)
    return operator.execute(active)


def execute_plan(
    plan: LogicalPlan,
    context: Optional[ExecutionContext] = None,
    optimizer: Optional[Optimizer] = None,
    sql: Optional[str] = None,
) -> QueryResult:
    """Optimize, execute and package a logical plan.

    Args:
        plan: The plan to run.
        context: Execution context; a default one is created when omitted.
        optimizer: Optimizer to use, or ``None`` for the default rule set.
        sql: The originating statement text, recorded on the result.
    """
    active = context or ExecutionContext()
    engine_optimizer = optimizer or default_optimizer()
    with active.metrics.timer("optimize"):
        optimized = engine_optimizer.optimize(plan)
    with active.tracer.span("execute"):
        operator = create_physical_plan(optimized, active)
        with active.metrics.timer("execute"):
            table = execute_operator(operator, active)
    active.metrics.increment("result.rows", table.num_rows)
    return QueryResult(
        table,
        metrics=active.metrics.to_dict(),
        logical_plan=plan,
        optimized_plan=optimized,
        sql=sql,
    )
