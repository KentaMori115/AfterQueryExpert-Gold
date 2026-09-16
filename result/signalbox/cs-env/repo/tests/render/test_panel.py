import pytest

from signalbox.render.panel import DEFAULT_PANEL, PanelPalette, render_panel
from signalbox.sim.train import Train
from signalbox.sim.world import build_world
from signalbox.topology.position import Position
from signalbox.units import Distance, Speed


@pytest.fixture
def world(kingsmoor):
    world = build_world(kingsmoor)
    world.add(Train("1A05", Position("D1", Distance(300.0)), speed=Speed.from_mph(20)))
    world.request("K1(M)")
    world.step(2.0)
    return world


def panel_for(world, **kwargs):
    return render_panel(world.scheme, world.machine.state, **kwargs)


def test_the_panel_is_an_svg(world):
    drawing = panel_for(world)
    assert drawing.startswith("<svg")
    assert drawing.rstrip().endswith("</svg>")


def test_the_heading_says_the_time(world):
    assert "Kingsmoor Junction at" in panel_for(world)


def test_a_title_can_be_given(world):
    assert "Peak hour" in panel_for(world, title="Peak hour")


def test_occupied_track_is_coloured(world):
    assert DEFAULT_PANEL.base.occupied in panel_for(world)


def test_a_failed_section_gets_its_own_colour(world):
    world.machine.fail_section("TC")
    assert DEFAULT_PANEL.failed in panel_for(world)


def test_a_cleared_signal_is_drawn_in_its_aspect(world):
    world.step(10.0)
    from signalbox.signalling.signal import Aspect

    assert DEFAULT_PANEL.base.for_aspect(Aspect.YELLOW) in panel_for(world)


def test_points_lying_reverse_are_drawn_differently(world):
    normal = panel_for(world)
    world.request("K3(MB)")
    world.step(20.0)
    reverse = panel_for(world)
    assert normal != reverse


def test_failed_points_are_drawn_in_the_failure_colour(world):
    world.machine.fail_points("P101")
    assert DEFAULT_PANEL.failed in panel_for(world)


def test_trains_are_drawn_where_they_are(world):
    fixes = tuple(world.history.at(world.clock))
    drawing = panel_for(world, fixes=fixes)
    assert "<rect" in drawing
    assert ">1A05<" in drawing


def test_no_trains_means_no_train_blocks(world):
    drawing = panel_for(world)
    assert ">1A05<" not in drawing


def test_the_palette_carries_the_schematic_one():
    assert PanelPalette().base.track
    assert PanelPalette(train="#ff0000").train == "#ff0000"


def test_the_signals_are_labelled(world):
    assert ">K1<" in panel_for(world)
