from cueforge.compiler.graph import build_graph
from cueforge.compiler.ordering import topological_order
from cueforge.compiler.triggers import NormalizedTrigger
from cueforge.timing.schedule import resolve_starts


def test_after_is_relative_to_start_not_end() -> None:
    triggers = {
        "lx": NormalizedTrigger(kind="absolute", cue_id="lx", offset_ms=0, at_ms=1000),
        "auto": NormalizedTrigger(kind="after", cue_id="auto", offset_ms=200, depends_on="lx"),
    }
    graph, _ = build_graph(triggers)
    order = topological_order(graph)
    schedule, findings = resolve_starts(triggers, order, {})
    assert findings == []
    assert schedule.starts["lx"] == 1000
    assert schedule.starts["auto"] == 1200


def test_negative_offset() -> None:
    triggers = {
        "auto": NormalizedTrigger(kind="absolute", cue_id="auto", offset_ms=0, at_ms=5000),
        "video": NormalizedTrigger(kind="after", cue_id="video", offset_ms=-1000, depends_on="auto"),
    }
    graph, _ = build_graph(triggers)
    order = topological_order(graph)
    schedule, _ = resolve_starts(triggers, order, {})
    assert schedule.starts["video"] == 4000


def test_event_trigger() -> None:
    triggers = {
        "lx": NormalizedTrigger(kind="event", cue_id="lx", offset_ms=-800, event="line_17"),
    }
    graph, _ = build_graph(triggers)
    schedule, _ = resolve_starts(triggers, ("lx",), {"line_17": 60000})
    assert schedule.starts["lx"] == 59200


def test_delay_propagates_to_dependents() -> None:
    triggers = {
        "a": NormalizedTrigger(kind="absolute", cue_id="a", offset_ms=0, at_ms=0),
        "b": NormalizedTrigger(kind="after", cue_id="b", offset_ms=100, depends_on="a"),
    }
    graph, _ = build_graph(triggers)
    schedule, _ = resolve_starts(triggers, ("a", "b"), {}, delays={"a": 250})
    assert schedule.starts["a"] == 250
    assert schedule.starts["b"] == 350


def test_manual_stays_unresolved() -> None:
    triggers = {
        "go": NormalizedTrigger(kind="manual", cue_id="go", offset_ms=0),
    }
    graph, _ = build_graph(triggers)
    schedule, _ = resolve_starts(triggers, ("go",), {})
    assert schedule.starts["go"] is None
