from cueforge.evidence.graph import EvidenceGraph
from cueforge.evidence.nodes import EvidenceNode


def test_graph_deduplicates_and_sorts() -> None:
    graph = EvidenceGraph()
    graph.add(EvidenceNode("t2", "measure", "pace", ("a", "b"), {"d": 3}, ()))
    graph.add(EvidenceNode("t1", "measure", "pace", ("a",), {"d": 1}, ()))
    graph.add(EvidenceNode("t2", "measure", "pace", ("a", "b"), {"d": 3}, ()))
    nodes = graph.sorted_nodes()
    assert [node.trace_id for node in nodes] == ["t1", "t2"]
    assert graph.as_list()[0]["trace_id"] == "t1"
