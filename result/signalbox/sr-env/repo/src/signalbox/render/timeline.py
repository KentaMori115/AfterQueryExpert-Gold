"""The train graph: distance up the page, time across it.

This is the drawing that makes a timetable argument short. Two trains that want
the same junction show up as two lines converging on the same height, and a
train standing at a signal shows up as a flat line. Nothing else in the toolkit
makes that as obvious.

Distance comes from the schematic placement rather than from mileage, so a
scheme that has never been dimensioned still graphs. The axis is therefore in
schematic units, which are proportional to metres along the line.
"""

from __future__ import annotations

from dataclasses import dataclass
from itertools import pairwise

from ..sim.history import History
from ..topology.scheme import Scheme
from .geometry import Placement, Point, place
from .svg import DEFAULT_PALETTE, Canvas, Palette

MARGIN = 50.0
DEFAULT_WIDTH = 720.0
DEFAULT_HEIGHT = 420.0

#: Trains are drawn in this order of colours, going round again if need be.
TRAIN_COLOURS = ("#2c3e50", "#c0392b", "#2980b9", "#27ae60", "#8e44ad", "#d35400")


@dataclass(frozen=True)
class Axes:
    """How a fix turns into a point on the paper."""

    start: float
    end: float
    low: float
    high: float
    width: float = DEFAULT_WIDTH
    height: float = DEFAULT_HEIGHT

    @property
    def seconds(self) -> float:
        return max(self.end - self.start, 1.0)

    @property
    def spread(self) -> float:
        return max(self.high - self.low, 1.0)

    def at(self, when: float, where: float) -> Point:
        x = (when - self.start) / self.seconds * self.width
        y = self.height - (where - self.low) / self.spread * self.height
        return Point(x, y)


def _distance(scheme: Scheme, placement: Placement, edge: str, offset: float) -> float:
    from ..topology.position import Position
    from ..units import Distance

    return placement.along(Position(edge, Distance(offset)), scheme.graph).x


def axes_for(
    scheme: Scheme,
    history: History,
    placement: Placement,
    *,
    width: float = DEFAULT_WIDTH,
    height: float = DEFAULT_HEIGHT,
) -> Axes:
    start, end = history.span()
    distances = [
        _distance(scheme, placement, fix.edge, fix.position.offset.metres) for fix in history
    ]
    low = min(distances, default=0.0)
    high = max(distances, default=1.0)
    return Axes(start, end, low, high, width, height)


def render_timeline(
    scheme: Scheme,
    history: History,
    *,
    placement: Placement | None = None,
    palette: Palette = DEFAULT_PALETTE,
    width: float = DEFAULT_WIDTH,
    height: float = DEFAULT_HEIGHT,
    title: str | None = None,
) -> str:
    """Draw a train graph from a run."""
    placement = placement or place(scheme)
    axes = axes_for(scheme, history, placement, width=width, height=height)
    canvas = Canvas()

    _draw_grid(canvas, axes, palette)
    _draw_signals(canvas, scheme, placement, axes, palette)
    _draw_trains(canvas, scheme, history, placement, axes)

    heading = title or f"{scheme.area or scheme.name}: train graph"
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'width="{width + MARGIN * 2:.0f}" height="{height + MARGIN * 2:.0f}" '
        f'viewBox="0 0 {width + MARGIN * 2:.0f} {height + MARGIN * 2:.0f}">\n'
        f'  <rect width="100%" height="100%" fill="{palette.background}" />\n'
        f'  <text x="{MARGIN:.0f}" y="{MARGIN / 2:.0f}" fill="{palette.label}" '
        f'font-size="12" font-family="Helvetica, Arial, sans-serif">{heading}</text>\n'
        f'  <g transform="translate({MARGIN:.0f}, {MARGIN:.0f})">\n'
        f"{canvas.render()}\n"
        "  </g>\n"
        "</svg>\n"
    )


def _draw_grid(canvas: Canvas, axes: Axes, palette: Palette) -> None:
    canvas.line(Point(0, axes.height), Point(axes.width, axes.height), palette.label, 1.0)
    canvas.line(Point(0, 0), Point(0, axes.height), palette.label, 1.0)

    for step in range(6):
        when = axes.start + axes.seconds * step / 5
        at = axes.at(when, axes.low)
        canvas.line(at, at.moved(0, 4), palette.label, 1.0)
        canvas.text(at.moved(0, 16), f"{when:.0f}s", palette.label, size=8)


def _draw_signals(
    canvas: Canvas, scheme: Scheme, placement: Placement, axes: Axes, palette: Palette
) -> None:
    for signal in scheme.sorted_signals():
        where = _distance(
            scheme, placement, signal.position.edge, signal.position.offset.metres
        )
        if not axes.low <= where <= axes.high:
            continue
        left = axes.at(axes.start, where)
        canvas.line(left, Point(axes.width, left.y), palette.label, 0.5, opacity="0.35")
        canvas.text(left.moved(-6, 3), signal.name, palette.label, size=7, anchor="end")


def _draw_trains(
    canvas: Canvas, scheme: Scheme, history: History, placement: Placement, axes: Axes
) -> None:
    for index, name in enumerate(history.trains()):
        colour = TRAIN_COLOURS[index % len(TRAIN_COLOURS)]
        fixes = history.of(name)
        points = [
            axes.at(
                fix.at,
                _distance(scheme, placement, fix.edge, fix.position.offset.metres),
            )
            for fix in fixes
        ]
        for one, two in pairwise(points):
            canvas.line(one, two, colour, 2.0)
        if points:
            canvas.text(points[-1].moved(6, 3), name, colour, size=8, anchor="start")
