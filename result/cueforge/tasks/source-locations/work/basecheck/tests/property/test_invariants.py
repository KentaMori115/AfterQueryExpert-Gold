import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from cueforge.compiler.graph import build_graph
from cueforge.compiler.ordering import topological_order
from cueforge.compiler.triggers import NormalizedTrigger
from cueforge.movement.geometry import Point, distance_units
from cueforge.reports.canonical_json import canonical_dumps
from cueforge.resources.reservations import Interval

pytestmark = pytest.mark.property


@settings(max_examples=40, deadline=None)
@given(
    x1=st.integers(-1000, 1000),
    y1=st.integers(-1000, 1000),
    x2=st.integers(-1000, 1000),
    y2=st.integers(-1000, 1000),
)
def test_distance_symmetric_and_non_negative(x1: int, y1: int, x2: int, y2: int) -> None:
    a, b = Point(x1, y1), Point(x2, y2)
    assert distance_units(a, b) >= 0
    assert distance_units(a, b) == distance_units(b, a)
    if a == b:
        assert distance_units(a, b) == 0


@settings(max_examples=30, deadline=None)
@given(start=st.integers(0, 10_000), length=st.integers(0, 5_000), gap=st.integers(0, 100))
def test_touching_intervals_never_overlap(start: int, length: int, gap: int) -> None:
    left = Interval(start, start + length)
    right = Interval(start + length + gap, start + length + gap + 10)
    if gap == 0:
        assert not left.overlaps(right)
    else:
        assert not left.overlaps(right) or gap < 0


@settings(max_examples=20, deadline=None)
@given(st.lists(st.sampled_from(["p", "q", "r", "s"]), min_size=2, max_size=4, unique=True))
def test_topo_ready_set_is_sorted(ids: list[str]) -> None:
    triggers = {
        cue_id: NormalizedTrigger(kind="absolute", cue_id=cue_id, offset_ms=0, at_ms=0)
        for cue_id in ids
    }
    graph, _ = build_graph(triggers)
    order = topological_order(graph)
    assert order == tuple(sorted(ids))


@settings(max_examples=15, deadline=None)
@given(st.dictionaries(st.sampled_from(["a", "b", "c"]), st.integers(0, 9), min_size=1))
def test_canonical_json_ignores_insertion_order(data: dict[str, int]) -> None:
    assert canonical_dumps(data) == canonical_dumps(dict(reversed(list(data.items()))))
