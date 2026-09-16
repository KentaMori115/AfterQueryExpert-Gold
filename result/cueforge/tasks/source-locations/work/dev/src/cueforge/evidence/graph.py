"""Acyclic shared evidence graph."""

from __future__ import annotations

from dataclasses import dataclass, field

from cueforge.evidence.nodes import EvidenceNode


@dataclass
class EvidenceGraph:
    nodes: dict[str, EvidenceNode] = field(default_factory=dict)

    def add(self, node: EvidenceNode) -> EvidenceNode:
        existing = self.nodes.get(node.trace_id)
        if existing is not None:
            return existing
        self.nodes[node.trace_id] = node
        return node

    def sorted_nodes(self) -> tuple[EvidenceNode, ...]:
        return tuple(self.nodes[key] for key in sorted(self.nodes))

    def as_list(self) -> list[dict[str, object]]:
        return [node.as_dict() for node in self.sorted_nodes()]
