"""Rendering of plan trees for ``EXPLAIN``.

Two layouts are available. The indented form is the default and matches what
most engines print; the box-drawing form is easier to read for deep trees with
several joins.
"""

from __future__ import annotations

from typing import Any, List, Optional, Sequence

from ..types.schema import Schema
from .logical import LogicalPlan

__all__ = ["format_plan", "format_plan_tree", "format_schema", "plan_summary"]


def format_plan(plan: LogicalPlan, indent: str = "  ", show_schema: bool = False) -> str:
    """Render a plan as an indented tree.

    Args:
        plan: The root node.
        indent: The string prepended once per level of depth.
        show_schema: When true each line is followed by its output schema.
    """
    lines: List[str] = []
    _render(plan, 0, indent, show_schema, lines)
    return "\n".join(lines)


def _render(
    node: Any, depth: int, indent: str, show_schema: bool, lines: List[str]
) -> None:
    prefix = indent * depth
    lines.append(f"{prefix}{_describe(node)}")
    if show_schema:
        schema = _schema_of(node)
        if schema is not None:
            lines.append(f"{prefix}{indent}-> {format_schema(schema)}")
    for child in _children_of(node):
        _render(child, depth + 1, indent, show_schema, lines)


def format_plan_tree(plan: LogicalPlan) -> str:
    """Render a plan using box-drawing connectors."""
    lines: List[str] = [_describe(plan)]
    _render_tree(list(_children_of(plan)), "", lines)
    return "\n".join(lines)


def _render_tree(children: Sequence[Any], prefix: str, lines: List[str]) -> None:
    for index, child in enumerate(children):
        last = index == len(children) - 1
        connector = "`-- " if last else "|-- "
        lines.append(f"{prefix}{connector}{_describe(child)}")
        extension = "    " if last else "|   "
        _render_tree(list(_children_of(child)), prefix + extension, lines)


def format_schema(schema: Schema) -> str:
    """Render a schema as a compact ``name:type`` list."""
    if not len(schema):
        return "()"
    return "(" + ", ".join(f"{item.name}:{item.dtype}" for item in schema) + ")"


def plan_summary(plan: LogicalPlan) -> str:
    """Return a one-line summary naming each node type in the tree."""
    counts: dict = {}
    for node in plan.walk():
        counts[node.node_name] = counts.get(node.node_name, 0) + 1
    parts = [
        f"{name}x{count}" if count > 1 else name
        for name, count in sorted(counts.items())
    ]
    return " ".join(parts)


def _describe(node: Any) -> str:
    """Return a node's one-line description, tolerating physical operators."""
    describe = getattr(node, "describe", None)
    if callable(describe):
        return describe()
    return type(node).__name__


def _children_of(node: Any) -> Sequence[Any]:
    """Return a node's children whether it is a plan or an operator."""
    children = getattr(node, "children", None)
    if callable(children):
        return children()
    if isinstance(children, (list, tuple)):
        return children
    return ()


def _schema_of(node: Any) -> Optional[Schema]:
    """Return a node's schema when it has one."""
    try:
        schema = node.schema
    except (AttributeError, NotImplementedError):
        return None
    return schema if isinstance(schema, Schema) else None
