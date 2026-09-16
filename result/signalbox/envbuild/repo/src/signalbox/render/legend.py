"""A key on the drawing, so that somebody who has not seen one can read it.

The schematic uses a handful of marks and none of them are self explanatory.
The legend draws each of them once with a name beside it, in a block that can be
put anywhere on the canvas.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..signalling.signal import Aspect
from .geometry import Point
from .svg import DEFAULT_PALETTE, Canvas, Palette

ROW_HEIGHT = 18.0
SAMPLE_WIDTH = 26.0
LABEL_GAP = 8.0


@dataclass(frozen=True)
class Entry:
    """One line of the key."""

    mark: str
    label: str

    def __str__(self) -> str:
        return f"{self.mark}: {self.label}"


ENTRIES = (
    Entry("track", "plain line"),
    Entry("occupied", "occupied track"),
    Entry("points", "points"),
    Entry("buffer", "buffer stop"),
    Entry("signal", "signal, coloured by aspect"),
    Entry("crossing", "level crossing"),
    Entry("trap", "trap points"),
)


def height(entries: tuple[Entry, ...] = ENTRIES) -> float:
    return ROW_HEIGHT * (len(entries) + 1)


def width(entries: tuple[Entry, ...] = ENTRIES) -> float:
    longest = max((len(entry.label) for entry in entries), default=0)
    return SAMPLE_WIDTH + LABEL_GAP + longest * 5.5


def draw_legend(
    canvas: Canvas,
    at: Point,
    *,
    palette: Palette = DEFAULT_PALETTE,
    entries: tuple[Entry, ...] = ENTRIES,
) -> None:
    """Draw the key with its top left corner at ``at``."""
    canvas.text(at.moved(0, -4), "key", palette.label, size=10, anchor="start")

    for index, entry in enumerate(entries):
        row = at.moved(0, ROW_HEIGHT * (index + 1))
        middle = row.moved(SAMPLE_WIDTH / 2, 0)
        if entry.mark == "track":
            canvas.line(row, row.moved(SAMPLE_WIDTH, 0), palette.track, 3.0)
        elif entry.mark == "occupied":
            canvas.line(row, row.moved(SAMPLE_WIDTH, 0), palette.occupied, 3.0)
        elif entry.mark == "points":
            canvas.line(row, row.moved(SAMPLE_WIDTH, 0), palette.track, 3.0)
            canvas.circle(middle, 3.5, palette.points)
        elif entry.mark == "buffer":
            canvas.line(row, row.moved(SAMPLE_WIDTH, 0), palette.track, 3.0)
            canvas.line(
                row.moved(SAMPLE_WIDTH, -7), row.moved(SAMPLE_WIDTH, 7), palette.buffer, 3.0
            )
        elif entry.mark == "crossing":
            canvas.line(row, row.moved(SAMPLE_WIDTH, 0), palette.track, 3.0)
            canvas.line(middle.moved(-4, -7), middle.moved(-4, 7), palette.crossing, 2.0)
            canvas.line(middle.moved(4, -7), middle.moved(4, 7), palette.crossing, 2.0)
        elif entry.mark == "trap":
            canvas.line(row, row.moved(SAMPLE_WIDTH, 0), palette.track, 3.0)
            canvas.line(middle, middle.moved(8, 6), palette.trap, 2.0)
        elif entry.mark == "signal":
            canvas.line(row, row.moved(SAMPLE_WIDTH, 0), palette.track, 3.0)
            canvas.line(middle, middle.moved(0, -12), palette.signal_post, 1.5)
            canvas.circle(middle.moved(0, -12), 3.0, palette.for_aspect(Aspect.GREEN))

        canvas.text(
            row.moved(SAMPLE_WIDTH + LABEL_GAP, 3),
            entry.label,
            palette.label,
            size=8,
            anchor="start",
        )
