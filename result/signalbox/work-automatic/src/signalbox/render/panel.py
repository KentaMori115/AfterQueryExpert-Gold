"""The panel view: the schematic with the state of the railway on it.

This is the drawing a signaller would be looking at. It is the same schematic as
``render.svg`` produces, with the track coloured by occupancy, the points drawn
lying the way they are lying, the signals coloured by aspect, and the trains
drawn where they are.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..signalling.signal import Aspect
from ..sim.history import Fix
from ..sim.state import SchemeState
from ..topology.graph import Lie
from ..topology.position import Position
from ..topology.scheme import Scheme
from ..units import Distance
from .geometry import Placement, Point, place
from .svg import (
    DEFAULT_PALETTE,
    MARGIN,
    SIGNAL_HEIGHT,
    TRACK_WIDTH,
    Canvas,
    Palette,
)

TRAIN_HEIGHT = 7.0
POINT_ARM = 9.0


@dataclass(frozen=True)
class PanelPalette:
    """The extra colours a panel needs on top of the schematic ones."""

    train: str = "#1a1a1a"
    train_label: str = "#ffffff"
    route_set: str = "#2980b9"
    failed: str = "#8e44ad"

    @property
    def base(self) -> Palette:
        return DEFAULT_PALETTE


DEFAULT_PANEL = PanelPalette()


def _draw_points(
    canvas: Canvas,
    scheme: Scheme,
    placement: Placement,
    state: SchemeState,
    panel: PanelPalette,
) -> None:
    """Show which way each set of points is lying, or that it has failed."""
    for name in scheme.graph.points():
        points = state.points.get(name)
        at = placement.at(name)
        if points is None:
            continue
        if not points.detected:
            canvas.circle(at, 4.5, panel.failed)
            continue
        arm = POINT_ARM if points.lie is Lie.REVERSE else -POINT_ARM
        canvas.line(at, at.moved(POINT_ARM, arm), panel.base.points, 2.0)
        canvas.circle(at, 3.0, panel.base.points)


def _draw_trains(
    canvas: Canvas,
    scheme: Scheme,
    placement: Placement,
    fixes: tuple[Fix, ...],
    panel: PanelPalette,
) -> None:
    for fix in fixes:
        front = placement.along(fix.position, scheme.graph)
        back = placement.along(_behind(scheme, fix), scheme.graph)
        left = min(front.x, back.x)
        width = max(abs(front.x - back.x), 6.0)
        canvas.rect(Point(left, front.y - TRAIN_HEIGHT / 2), width, TRAIN_HEIGHT, panel.train)
        canvas.text(front.moved(0, -12), fix.train, panel.train, size=8)


def _behind(scheme: Scheme, fix: Fix) -> Position:
    """A point a little behind the train, so it draws as a block not a line."""
    edge = scheme.graph.edge(fix.position.edge)
    offset = max(fix.position.offset.metres - 60.0, 0.0)
    del edge
    return Position(fix.position.edge, Distance(offset), fix.position.sense)


def render_panel(
    scheme: Scheme,
    state: SchemeState,
    *,
    fixes: tuple[Fix, ...] = (),
    placement: Placement | None = None,
    panel: PanelPalette = DEFAULT_PANEL,
    title: str | None = None,
) -> str:
    """Draw the railway as it stands."""
    placement = placement or place(scheme)
    palette = panel.base
    canvas = Canvas()

    for name, (start, end) in sorted(placement.edges.items()):
        section = scheme.sections.name_for(name)
        colour = palette.track
        if section is not None and state.has_failed(section):
            colour = panel.failed
        elif section is not None and state.is_occupied(section):
            colour = palette.occupied
        canvas.line(start, end, colour, TRACK_WIDTH)

    for signal in scheme.sorted_signals():
        at = placement.along(signal.position, scheme.graph)
        head = at.moved(0, -4 - SIGNAL_HEIGHT)
        canvas.line(at.moved(0, -4), head, palette.signal_post, 1.5)
        showing = state.aspects.get(signal.name, Aspect.RED)
        canvas.circle(head, 3.0, palette.for_aspect(showing))
        canvas.text(head.moved(0, -6), signal.name, palette.label, size=8)

    _draw_points(canvas, scheme, placement, state, panel)
    _draw_trains(canvas, scheme, placement, fixes, panel)

    left, top, right, bottom = placement.bounds()
    width = (right - left) + MARGIN * 2
    height = (bottom - top) + MARGIN * 2 + SIGNAL_HEIGHT
    heading = title or f"{scheme.area or scheme.name} at {state.clock:.0f}s"

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width:.0f}" '
        f'height="{height:.0f}" viewBox="0 0 {width:.0f} {height:.0f}">\n'
        f'  <rect width="100%" height="100%" fill="{palette.background}" />\n'
        f'  <text x="{MARGIN:.0f}" y="{MARGIN / 2:.0f}" fill="{palette.label}" '
        f'font-size="12" font-family="Helvetica, Arial, sans-serif">{heading}</text>\n'
        f'  <g transform="translate({MARGIN - left:.1f}, {MARGIN - top:.1f})">\n'
        f"{canvas.render()}\n"
        "  </g>\n"
        "</svg>\n"
    )
