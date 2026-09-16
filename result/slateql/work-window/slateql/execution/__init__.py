"""Physical planning and execution."""

from .aggregators import AggregateSpec, GroupState, build_specs
from .batch import RecordBatch, batches_from_rows, concat_batches
from .context import ExecutionContext, ExecutionMetrics
from .evaluator import ExpressionEvaluator, compile_expression
from .keys import keys_for, row_key, value_key
from .operators import Operator
from .pipeline import collect, execute_operator, stream_rows
from .planner import PhysicalPlanner, extract_equi_keys, plan_to_operator

__all__ = [
    "AggregateSpec",
    "GroupState",
    "build_specs",
    "RecordBatch",
    "batches_from_rows",
    "concat_batches",
    "ExecutionContext",
    "ExecutionMetrics",
    "ExpressionEvaluator",
    "compile_expression",
    "keys_for",
    "row_key",
    "value_key",
    "Operator",
    "collect",
    "execute_operator",
    "stream_rows",
    "PhysicalPlanner",
    "extract_equi_keys",
    "plan_to_operator",
]
