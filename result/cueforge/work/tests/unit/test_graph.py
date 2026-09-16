from cueforge.compiler.graph import build_graph, cycle_findings, find_cycles
from cueforge.compiler.ordering import topological_order
from cueforge.compiler.triggers import NormalizedTrigger


def _after(cue_id: str, dep: str, offset: int = 0) -> NormalizedTrigger:
    return NormalizedTrigger(kind="after", cue_id=cue_id, offset_ms=offset, depends_on=dep)


def _abs(cue_id: str, at: int) -> NormalizedTrigger:
    return NormalizedTrigger(kind="absolute", cue_id=cue_id, offset_ms=0, at_ms=at)


def test_cycle_witness_is_rotated_to_smallest_id() -> None:
    triggers = {
        "c": _after("c", "b"),
        "b": _after("b", "a"),
        "a": _after("a", "c"),
    }
    graph, _ = build_graph(triggers)
    cycles = find_cycles(graph)
    assert cycles
    assert cycles[0][0] == min(cycles[0])
    findings = cycle_findings(cycles)
    assert findings[0].code == "CF3002"
    assert "a" in findings[0].message


def test_self_loop_is_a_cycle() -> None:
    triggers = {"a": _after("a", "a")}
    graph, _ = build_graph(triggers)
    cycles = find_cycles(graph)
    assert cycles == [("a",)]


def test_topological_order_is_stable_for_ready_set() -> None:
    triggers = {
        "b": _abs("b", 0),
        "a": _abs("a", 0),
        "c": _after("c", "a"),
    }
    graph, _ = build_graph(triggers)
    order = topological_order(graph)
    assert order.index("a") < order.index("c")
    assert order[0] in {"a", "b"}
    assert order[:2] == ("a", "b") or order[0] == "a"


def test_missing_dependency_finding() -> None:
    triggers = {"a": _after("a", "ghost")}
    _, findings = build_graph(triggers)
    assert any(item.code == "CF3001" for item in findings)
