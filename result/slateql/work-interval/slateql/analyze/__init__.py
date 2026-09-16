"""Semantic analysis: scope resolution, type checking, and plan construction."""

from .aggregates import AggregateRewriter
from .binder import Binder, bind_statement
from .scope import OutputScope, Scope
from .typecheck import ExpressionBinder, derive_name
from .validate import validate_plan

__all__ = [
    "AggregateRewriter",
    "Binder",
    "bind_statement",
    "OutputScope",
    "Scope",
    "ExpressionBinder",
    "derive_name",
    "validate_plan",
]
