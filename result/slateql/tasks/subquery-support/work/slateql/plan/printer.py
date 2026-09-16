"""Render logical and physical plans as indented trees for EXPLAIN."""

from __future__ import annotations

from typing import Any, Callable, Optional, Sequence

from .logical import LogicalPlan

__all__ = ["format_plan", "format_tree", "plan_lines"]


def plan_lines(
    plan: LogicalPlan,
    *,
    annotate: Optional[Callable[[LogicalPlan], str]] = None,
) -> list[str]:
    """Return the EXPLAIN lines for ``plan`` using box-drawing connectors."""

    lines: list[str] = []

    def _emit(node: LogicalPlan, prefix: str, is_last: bool, is_root: bool) -> None:
        if is_root:
            connector = ""
            child_prefix = prefix
        else:
            connector = "`- " if is_last else "|- "
            child_prefix = prefix + ("   " if is_last else "|  ")
        text = node.describe()
        if annotate is not None:
            extra = annotate(node)
            if extra:
                text = f"{text}  {extra}"
        lines.append(f"{prefix}{connector}{text}")
        children = list(node.children())
        nested = list(node.subplans())
        total = len(children) + len(nested)
        for index, child in enumerate(children):
            _emit(child, child_prefix, index == total - 1, False)
        for offset, subplan in enumerate(nested):
            last = len(children) + offset == total - 1
            lines.append(f"{child_prefix}{'`- ' if last else '|- '}Subquery")
            _emit(subplan, child_prefix + ("   " if last else "|  "), True, False)

    _emit(plan, "", True, True)
    return lines


def format_plan(
    plan: LogicalPlan,
    *,
    annotate: Optional[Callable[[LogicalPlan], str]] = None,
) -> str:
    """Render ``plan`` as a multi-line string."""

    return "\n".join(plan_lines(plan, annotate=annotate))


def format_tree(
    root: Any,
    children_of: Callable[[Any], Sequence[Any]],
    label_of: Callable[[Any], str],
) -> str:
    """Generic tree renderer shared with the physical plan printer."""

    lines: list[str] = []

    def _emit(node: Any, prefix: str, is_last: bool, is_root: bool) -> None:
        connector = "" if is_root else ("`- " if is_last else "|- ")
        lines.append(f"{prefix}{connector}{label_of(node)}")
        child_prefix = prefix if is_root else prefix + ("   " if is_last else "|  ")
        children = list(children_of(node))
        for index, child in enumerate(children):
            _emit(child, child_prefix, index == len(children) - 1, False)

    _emit(root, "", True, True)
    return "\n".join(lines)
