"""Fixtures shared by the whole suite.

``kingsmoor`` is the layout almost every test works against. It is a real
enough junction to exercise facing points, a crossover, a bay and a branch
without being so large that a failure is hard to read.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from signalbox.layout.loader import load_path
from signalbox.topology.scheme import Scheme, build_scheme

DATA = Path(__file__).parent / "data"


@pytest.fixture(scope="session")
def kingsmoor_text() -> str:
    return (DATA / "kingsmoor.sbx").read_text(encoding="utf-8")


@pytest.fixture
def kingsmoor() -> Scheme:
    return build_scheme(load_path(DATA / "kingsmoor.sbx"))
