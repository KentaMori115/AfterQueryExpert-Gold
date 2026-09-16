"""Trigger dependency graph and cycle witnesses."""

from __future__ import annotations

from dataclasses import dataclass

from cueforge.codes import CF3001_MISSING_CUE, CF3002_TRIGGER_CYCLE
from cueforge.compiler.triggers import NormalizedTrigger
from cueforge.findings import Finding, Severity


@dataclass(frozen=True, slots=True)
class TriggerGraph:
    """Directed edges from dependency toward dependent cue."""

    nodes: tuple[str, ...]
    edges: tuple[tuple[str, str], ...]
    successors: dict[str, tuple[str, ...]]
    predecessors: dict[str, tuple[str, ...]]


def build_graph(
    triggers: dict[str, NormalizedTrigger],
) -> tuple[TriggerGraph, list[Finding]]:
    findings: list[Finding] = []
    nodes = tuple(sorted(triggers))
    successors: dict[str, list[str]] = {cue_id: [] for cue_id in nodes}
    predecessors: dict[str, list[str]] = {cue_id: [] for cue_id in nodes}
    edges: list[tuple[str, str]] = []

    for cue_id, trigger in triggers.items():
        if trigger.depends_on is None:
            continue
        if trigger.depends_on not in triggers:
            findings.append(
                Finding(
                    code=CF3001_MISSING_CUE,
                    severity=Severity.ERROR,
                    message=f"cue {cue_id!r} depends on missing cue {trigger.depends_on!r}",
                    subject_kind="cue",
                    subject_id=cue_id,
                    witness={"missing": trigger.depends_on},
                )
            )
            continue
        successors[trigger.depends_on].append(cue_id)
        predecessors[cue_id].append(trigger.depends_on)
        edges.append((trigger.depends_on, cue_id))

    for cue_id in nodes:
        successors[cue_id].sort()
        predecessors[cue_id].sort()
    edges.sort()
    return (
        TriggerGraph(
            nodes=nodes,
            edges=tuple(edges),
            successors={key: tuple(value) for key, value in successors.items()},
            predecessors={key: tuple(value) for key, value in predecessors.items()},
        ),
        findings,
    )


def _rotate_cycle(cycle: list[str]) -> tuple[str, ...]:
    """Rotate a cycle so it starts at the lexicographically smallest id."""
    if not cycle:
        return ()
    start = min(range(len(cycle)), key=lambda index: cycle[index])
    rotated = cycle[start:] + cycle[:start]
    return tuple(rotated)


def find_cycles(graph: TriggerGraph) -> list[tuple[str, ...]]:
    """Return unique cycles, each rotated to a stable witness order."""
    index = 0
    indices: dict[str, int] = {}
    lowlink: dict[str, int] = {}
    stack: list[str] = []
    on_stack: set[str] = set()
    cycles: list[tuple[str, ...]] = []

    def strongconnect(node: str) -> None:
        nonlocal index
        indices[node] = index
        lowlink[node] = index
        index += 1
        stack.append(node)
        on_stack.add(node)
        for succ in graph.successors.get(node, ()):
            if succ not in indices:
                strongconnect(succ)
                lowlink[node] = min(lowlink[node], lowlink[succ])
            elif succ in on_stack:
                lowlink[node] = min(lowlink[node], indices[succ])
        if lowlink[node] == indices[node]:
            component: list[str] = []
            while True:
                item = stack.pop()
                on_stack.remove(item)
                component.append(item)
                if item == node:
                    break
            if len(component) > 1:
                cycles.append(_rotate_cycle(sorted(component) if False else component))
            elif component and component[0] in graph.successors.get(component[0], ()):
                cycles.append((component[0],))

    for node in graph.nodes:
        if node not in indices:
            strongconnect(node)

    # Prefer a simple directed-cycle walk for a readable edge order.
    readable: list[tuple[str, ...]] = []
    seen: set[tuple[str, ...]] = set()
    for component in cycles:
        members = set(component)
        start = min(members)
        walk = [start]
        current = start
        guard = 0
        while guard <= len(members):
            nxts = [succ for succ in graph.successors[current] if succ in members]
            if not nxts:
                break
            nxt = sorted(nxts)[0] if len(walk) == 1 else min(nxts, key=lambda item: (item != start, item))
            # follow the unique cycle path preferring return-to-start
            preferred = [item for item in nxts if item == start and len(walk) > 1]
            nxt = preferred[0] if preferred else sorted(nxts)[0]
            walk.append(nxt)
            current = nxt
            if current == start and len(walk) > 1:
                break
            guard += 1
        witness = _rotate_cycle(walk[:-1] if walk and walk[-1] == walk[0] else walk)
        if witness and witness not in seen:
            seen.add(witness)
            readable.append(witness)
    readable.sort()
    return readable


def cycle_findings(cycles: list[tuple[str, ...]]) -> list[Finding]:
    findings: list[Finding] = []
    for cycle in cycles:
        chain = " -> ".join([*cycle, cycle[0]]) if cycle else ""
        findings.append(
            Finding(
                code=CF3002_TRIGGER_CYCLE,
                severity=Severity.ERROR,
                message=f"trigger cycle: {chain}",
                subject_kind="graph",
                subject_id=cycle[0] if cycle else None,
                witness={"cycle": ",".join(cycle), "length": len(cycle)},
            )
        )
    return findings
