"""Stable topological ordering for compiled cues."""

from __future__ import annotations

from collections import deque

from cueforge.compiler.graph import TriggerGraph


def topological_order(graph: TriggerGraph) -> tuple[str, ...]:
    """Kahn order: at each step choose the lexicographically smallest ready cue."""
    indegree = {node: len(graph.predecessors.get(node, ())) for node in graph.nodes}
    ready = deque(sorted(node for node, degree in indegree.items() if degree == 0))
    order: list[str] = []
    while ready:
        node = ready.popleft()
        order.append(node)
        for succ in graph.successors.get(node, ()):
            indegree[succ] -= 1
            if indegree[succ] == 0:
                # insert keeping ready sorted
                inserted = False
                for index, existing in enumerate(ready):
                    if succ < existing:
                        ready.insert(index, succ)
                        inserted = True
                        break
                if not inserted:
                    ready.append(succ)
    if len(order) != len(graph.nodes):
        # Cycle remains; return nodes in identifier order for diagnostics.
        remaining = sorted(node for node in graph.nodes if node not in order)
        return tuple(order + remaining)
    return tuple(order)
