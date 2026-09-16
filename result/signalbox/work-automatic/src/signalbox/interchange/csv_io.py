"""Writing the tables out as CSV, because that is what gets asked for.

The interchange file is the one that matters, but somebody always wants the
control table in a spreadsheet, and doing it by hand is how a column goes
missing. This writes a directory of files, one per table, all with the same
sorting the rest of the toolkit uses.
"""

from __future__ import annotations

import csv
import io
from collections.abc import Sequence
from pathlib import Path

from ..signalling.interlocking import Interlocking
from ..tables.aspect_table import ASPECT_COLUMNS, build_aspect_table
from ..tables.control_table import COLUMNS, build_control_table
from ..tables.locking_table import LOCKING_COLUMNS, build_locking_report
from ..tables.points_table import POINT_COLUMNS, build_points_table
from ..topology.scheme import Scheme
from .json_io import InterchangeError

#: The files written, in the order they are listed by ``write_all``.
FILES = ("control.csv", "points.csv", "aspects.csv", "locking.csv")


def _csv(columns: Sequence[str], rows: Sequence[object]) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(columns)
    for row in rows:
        writer.writerow([row.cell(column) for column in columns])  # type: ignore[attr-defined]
    return buffer.getvalue()


def control_csv(scheme: Scheme, interlocking: Interlocking) -> str:
    return _csv(COLUMNS, list(build_control_table(scheme, interlocking)))


def points_csv(scheme: Scheme, interlocking: Interlocking) -> str:
    return _csv(POINT_COLUMNS, list(build_points_table(scheme, interlocking)))


def aspects_csv(scheme: Scheme, interlocking: Interlocking) -> str:
    return _csv(ASPECT_COLUMNS, list(build_aspect_table(scheme, interlocking)))


def locking_csv(scheme: Scheme, interlocking: Interlocking) -> str:
    del scheme
    return _csv(LOCKING_COLUMNS, list(build_locking_report(interlocking)))


WRITERS = {
    "control.csv": control_csv,
    "points.csv": points_csv,
    "aspects.csv": aspects_csv,
    "locking.csv": locking_csv,
}


def write_all(directory: str | Path, scheme: Scheme, interlocking: Interlocking) -> list[Path]:
    """Write every table into ``directory``, which is created if it is not there."""
    target = Path(directory)
    try:
        target.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise InterchangeError(f"cannot make {target}: {exc.strerror}") from None

    written: list[Path] = []
    for name in FILES:
        path = target / name
        try:
            path.write_text(WRITERS[name](scheme, interlocking), encoding="utf-8")
        except OSError as exc:
            raise InterchangeError(f"cannot write {path}: {exc.strerror}") from None
        written.append(path)
    return written
