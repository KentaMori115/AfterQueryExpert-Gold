from cueforge.simulation.events import KIND_RANK, SimulationEvent


def test_kind_ranks_are_unique_and_documented() -> None:
    assert KIND_RANK["eligible"] < KIND_RANK["started"]
    assert KIND_RANK["started"] < KIND_RANK["completed"]
    assert KIND_RANK["failed"] < KIND_RANK["started"]
    assert len(set(KIND_RANK.values())) == len(KIND_RANK)


def test_event_sort_uses_time_kind_cue_sequence() -> None:
    a = SimulationEvent(10, "completed", "b", 2, None, ("b",))
    b = SimulationEvent(10, "started", "a", 1, None, ("a",))
    c = SimulationEvent(5, "eligible", "a", 1, None, ("a",))
    ordered = sorted([a, b, c], key=lambda item: item.sort_key())
    assert [item.kind for item in ordered] == ["eligible", "started", "completed"]
