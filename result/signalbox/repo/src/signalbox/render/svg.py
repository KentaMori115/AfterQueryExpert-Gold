"""Drawing the schematic as SVG.

The output is meant to be looked at in a browser and pasted into a design
record, so it is plain SVG with no script and no external references. Colours
come from a small palette rather than being written into the drawing code, so
that a scheme drawn with train positions on it looks like the same drawing.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from xml.sax.saxutils import escape

from ..signalling.signal import Aspect, SignalType
from ..topology.scheme import Scheme
from .geometry import Placement, Point, place

MARGIN = 40.0
TRACK_WIDTH = 3.0
SIGNAL_HEIGHT = 14.0


@dataclass(frozen=True)
class Palette:
    """The colours a drawing uses."""

    background: str = "#fbfbf8"
    track: str = "#3a3a3a"
    occupied: str = "#c0392b"
    label: str = "#555555"
    points: str = "#2c3e50"
    buffer: str = "#7f8c8d"
    signal_post: str = "#333333"
    crossing: str = "#b8860b"
    trap: str = "#8e44ad"
    aspects: dict[Aspect, str] = field(
        default_factory=lambda: {
            Aspect.RED: "#c0392b",
            Aspect.YELLOW: "#e6b800",
            Aspect.DOUBLE_YELLOW: "#e6b800",
            Aspect.GREEN: "#27ae60",
        }
    )

    def for_aspect(self, aspect: Aspect) -> str:
        return self.aspects[aspect]


DEFAULT_PALETTE = Palette()


class Canvas:
    """Somewhere to put SVG elements before they are joined up."""

    def __init__(self) -> None:
        self.parts: list[str] = []

    def line(self, a: Point, b: Point, colour: str, width: float, **extra: str) -> None:
        attrs = "".join(f' {name}="{value}"' for name, value in sorted(extra.items()))
        self.parts.append(
            f'<line x1="{a.x:.1f}" y1="{a.y:.1f}" x2="{b.x:.1f}" y2="{b.y:.1f}" '
            f'stroke="{colour}" stroke-width="{width}"{attrs} />'
        )

    def circle(self, at: Point, radius: float, colour: str) -> None:
        self.parts.append(
            f'<circle cx="{at.x:.1f}" cy="{at.y:.1f}" r="{radius}" fill="{colour}" />'
        )

    def text(
        self, at: Point, words: str, colour: str, size: float = 9.0, anchor: str = "middle"
    ) -> None:
        self.parts.append(
            f'<text x="{at.x:.1f}" y="{at.y:.1f}" fill="{colour}" font-size="{size}" '
            f'font-family="Helvetica, Arial, sans-serif" text-anchor="{anchor}">'
            f"{escape(words)}</text>"
        )

    def rect(self, at: Point, width: float, height: float, colour: str) -> None:
        self.parts.append(
            f'<rect x="{at.x:.1f}" y="{at.y:.1f}" width="{width:.1f}" '
            f'height="{height:.1f}" fill="{colour}" />'
        )

    def render(self) -> str:
        return "\n".join(f"  {part}" for part in self.parts)


def render_svg(
    scheme: Scheme,
    placement: Placement | None = None,
    *,
    occupied: set[str] | None = None,
    aspects: dict[str, Aspect] | None = None,
    palette: Palette = DEFAULT_PALETTE,
    title: str | None = None,
    legend: bool = False,
) -> str:
    """Draw a scheme, optionally with track occupancy and signal aspects on it."""
    from .legend import draw_legend
    from .legend import height as legend_height

    placement = placement or place(scheme)
    occupied = occupied or set()
    aspects = aspects or {}
    canvas = Canvas()

    _draw_track(canvas, scheme, placement, occupied, palette)
    _draw_nodes(canvas, scheme, placement, palette)
    _draw_crossings(canvas, scheme, placement, palette)
    _draw_traps(canvas, scheme, placement, palette)
    _draw_signals(canvas, scheme, placement, aspects, palette)

    left, top, right, bottom = placement.bounds()
    if legend:
        draw_legend(canvas, Point(left, bottom + MARGIN), palette=palette)
        bottom += MARGIN + legend_height()

    width = (right - left) + MARGIN * 2
    height = (bottom - top) + MARGIN * 2 + SIGNAL_HEIGHT
    shift_x = MARGIN - left
    shift_y = MARGIN - top

    heading = ""
    if title or scheme.area:
        heading = (
            f'  <text x="{MARGIN:.1f}" y="{MARGIN / 2:.1f}" fill="{palette.label}" '
            f'font-size="12" font-family="Helvetica, Arial, sans-serif">'
            f"{escape(title or scheme.area or '')}</text>\n"
        )

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width:.0f}" height="{height:.0f}" '
        f'viewBox="0 0 {width:.0f} {height:.0f}">\n'
        f'  <rect width="100%" height="100%" fill="{palette.background}" />\n'
        f"{heading}"
        f'  <g transform="translate({shift_x:.1f}, {shift_y:.1f})">\n'
        f"{canvas.render()}\n"
        "  </g>\n"
        "</svg>\n"
    )


def _draw_track(
    canvas: Canvas,
    scheme: Scheme,
    placement: Placement,
    occupied: set[str],
    palette: Palette,
) -> None:
    for name, (start, end) in sorted(placement.edges.items()):
        section = scheme.sections.name_for(name)
        colour = palette.occupied if section in occupied else palette.track
        canvas.line(start, end, colour, TRACK_WIDTH)
        middle = Point((start.x + end.x) / 2, (start.y + end.y) / 2 - 6)
        canvas.text(middle, section or name, palette.label, size=8)


def _draw_nodes(canvas: Canvas, scheme: Scheme, placement: Placement, palette: Palette) -> None:
    for name, node in sorted(scheme.graph.nodes.items()):
        at = placement.at(name)
        if node.is_points:
            canvas.circle(at, 3.5, palette.points)
            canvas.text(at.moved(0, 16), name, palette.points, size=8)
        elif node.kind.value == "buffer":
            canvas.line(at.moved(0, -7), at.moved(0, 7), palette.buffer, 3.0)
        elif node.kind.value == "boundary":
            canvas.text(at.moved(0, -10), name, palette.label, size=8)


def _draw_crossings(
    canvas: Canvas, scheme: Scheme, placement: Placement, palette: Palette
) -> None:
    """A level crossing is drawn as the road going over the railway."""
    for name in sorted(scheme.crossings):
        crossing = scheme.crossing(name)
        at = placement.along(crossing.position, scheme.graph)
        canvas.line(at.moved(-4, -10), at.moved(-4, 10), palette.crossing, 2.0)
        canvas.line(at.moved(4, -10), at.moved(4, 10), palette.crossing, 2.0)
        canvas.text(at.moved(0, 22), name, palette.crossing, size=7)


def _draw_traps(canvas: Canvas, scheme: Scheme, placement: Placement, palette: Palette) -> None:
    """A trap is drawn as a short spur off the side of the track."""
    for name in sorted(scheme.traps):
        trap = scheme.trap(name)
        at = placement.along(trap.position, scheme.graph)
        canvas.line(at, at.moved(10, 8), palette.trap, 2.0)
        canvas.text(at.moved(0, 20), name, palette.trap, size=7)


def _draw_signals(
    canvas: Canvas,
    scheme: Scheme,
    placement: Placement,
    aspects: dict[str, Aspect],
    palette: Palette,
) -> None:
    for signal in scheme.sorted_signals():
        at = placement.along(signal.position, scheme.graph)
        up = signal.type is SignalType.SHUNT
        foot = at.moved(0, 4 if up else -4)
        head = at.moved(0, 4 + SIGNAL_HEIGHT if up else -4 - SIGNAL_HEIGHT)
        canvas.line(foot, head, palette.signal_post, 1.5)
        canvas.circle(head, 3.0, palette.for_aspect(aspects.get(signal.name, Aspect.RED)))
        canvas.text(head.moved(0, -6 if not up else 12), signal.name, palette.label, size=8)
