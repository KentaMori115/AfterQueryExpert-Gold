from cueforge.reports.trace import events_to_ndjson
from cueforge.simulation.events import SimulationEvent


def test_ndjson_one_object_per_line() -> None:
    events = (
        SimulationEvent(0, "eligible", "a", 1, None, ("a",)),
        SimulationEvent(0, "started", "a", 2, 1, ("a",), {"duration_ms": 10}),
    )
    text = events_to_ndjson(events)
    lines = text.split("\n")
    assert lines[-1] == ""
    assert len(lines) == 3
    assert '"kind":"eligible"' in lines[0]
    assert lines[0].endswith("}")


def test_empty_trace() -> None:
    assert events_to_ndjson(()) == ""
