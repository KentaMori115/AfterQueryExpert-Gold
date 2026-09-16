import pytest

from signalbox.render.geometry import place
from signalbox.render.timeline import TRAIN_COLOURS, Axes, axes_for, render_timeline
from signalbox.sim.history import History
from signalbox.sim.train import Train
from signalbox.sim.world import build_world
from signalbox.topology.position import Position
from signalbox.units import Distance, Speed


@pytest.fixture
def run(kingsmoor):
    world = build_world(kingsmoor)
    world.add(Train("1A05", Position("D1", Distance(60.0)), speed=Speed.from_mph(20)))
    world.request("K1(M)")
    for _ in range(30):
        world.step(2.0)
    return world


def test_the_axes_cover_the_whole_run(run):
    axes = axes_for(run.scheme, run.history, place(run.scheme))
    start, end = run.history.span()
    assert axes.start == start
    assert axes.end == end
    assert axes.high >= axes.low


def test_the_axes_map_the_start_to_the_left(run):
    axes = axes_for(run.scheme, run.history, place(run.scheme))
    assert axes.at(axes.start, axes.low).x == pytest.approx(0.0)
    assert axes.at(axes.end, axes.low).x == pytest.approx(axes.width)


def test_distance_goes_up_the_page():
    axes = Axes(0.0, 100.0, 0.0, 100.0, 200.0, 200.0)
    assert axes.at(0.0, 100.0).y < axes.at(0.0, 0.0).y


def test_an_empty_span_does_not_divide_by_zero():
    axes = Axes(0.0, 0.0, 0.0, 0.0)
    assert axes.seconds == 1.0
    assert axes.spread == 1.0
    assert axes.at(0.0, 0.0).x == 0.0


def test_the_graph_is_an_svg(run):
    drawing = render_timeline(run.scheme, run.history)
    assert drawing.startswith("<svg")
    assert drawing.rstrip().endswith("</svg>")


def test_the_train_is_drawn_and_named(run):
    drawing = render_timeline(run.scheme, run.history)
    assert ">1A05<" in drawing
    assert TRAIN_COLOURS[0] in drawing


def test_the_signals_are_ruled_across(run):
    drawing = render_timeline(run.scheme, run.history)
    assert ">K1<" in drawing
    assert 'opacity="0.35"' in drawing


def test_the_time_axis_is_labelled(run):
    drawing = render_timeline(run.scheme, run.history)
    assert ">0s<" in drawing


def test_a_title_can_be_given(run):
    assert "Down peak" in render_timeline(run.scheme, run.history, title="Down peak")


def test_the_area_is_the_default_title(run):
    assert "Kingsmoor Junction" in render_timeline(run.scheme, run.history)


def test_an_empty_history_still_draws(kingsmoor):
    drawing = render_timeline(kingsmoor, History())
    assert drawing.startswith("<svg")


def test_the_size_can_be_chosen(run):
    small = render_timeline(run.scheme, run.history, width=200.0, height=100.0)
    assert 'width="300"' in small
