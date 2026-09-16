"""The output of the whole toolkit, recorded and compared.

Unit tests say each piece is right. These say the answer has not changed, which
is a different and much blunter question, and the one that matters when a change
to route finding quietly alters two hundred rows of a control table.

To accept a change, run with SIGNALBOX_UPDATE_GOLDEN=1 and read the diff.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from signalbox.interchange.json_io import dumps
from signalbox.interchange.report import write_report
from signalbox.layout.loader import load_path
from signalbox.signalling.interlocking import build_interlocking
from signalbox.tables.control_table import build_control_table
from signalbox.tables.locking_table import LOCKING_COLUMNS, build_locking_report
from signalbox.tables.points_table import POINT_COLUMNS, build_points_table
from signalbox.tables.render import render_csv, render_text
from signalbox.topology.scheme import build_scheme

GOLDEN = Path(__file__).parent / "golden"
PLAN = Path(__file__).parent / "data" / "kingsmoor.sbx"


@pytest.fixture(scope="module")
def kingsmoor_scheme():
    return build_scheme(load_path(PLAN))


@pytest.fixture(scope="module")
def lock(kingsmoor_scheme):
    return build_interlocking(kingsmoor_scheme)


def compare(name: str, produced: str) -> None:
    """Compare against the recorded answer, or record it if asked to."""
    path = GOLDEN / name
    if os.environ.get("SIGNALBOX_UPDATE_GOLDEN"):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(produced, encoding="utf-8")
        return
    assert path.exists(), f"no recorded answer for {name}, run with SIGNALBOX_UPDATE_GOLDEN=1"
    recorded = path.read_text(encoding="utf-8")
    assert produced == recorded, f"{name} has changed"


def test_the_control_table_is_what_it_was(kingsmoor_scheme, lock):
    table = build_control_table(kingsmoor_scheme, lock)
    compare("kingsmoor-control.csv", render_csv(table))


def test_the_points_table_is_what_it_was(kingsmoor_scheme, lock):
    table = build_points_table(kingsmoor_scheme, lock)
    compare("kingsmoor-points.txt", render_text(list(table), POINT_COLUMNS))


def test_the_locking_table_is_what_it_was(kingsmoor_scheme, lock):
    report = build_locking_report(lock)
    compare("kingsmoor-locking.txt", render_text(list(report), LOCKING_COLUMNS))


def test_the_interchange_file_is_what_it_was(kingsmoor_scheme, lock):
    compare("kingsmoor.sbj", dumps(kingsmoor_scheme, lock))


def test_the_report_is_what_it_was(kingsmoor_scheme, lock):
    compare("kingsmoor-report.txt", write_report(kingsmoor_scheme, lock))


def test_every_recorded_answer_is_used():
    used = {
        "kingsmoor-control.csv",
        "kingsmoor-points.txt",
        "kingsmoor-locking.txt",
        "kingsmoor.sbj",
        "kingsmoor-report.txt",
    }
    assert {path.name for path in GOLDEN.iterdir()} == used


def test_the_recorded_control_table_has_a_row_for_every_route(lock):
    lines = (GOLDEN / "kingsmoor-control.csv").read_text().splitlines()
    assert len(lines) == len(lock) + 1
