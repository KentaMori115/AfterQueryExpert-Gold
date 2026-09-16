"""The example script is documentation, so it has to keep working."""

from __future__ import annotations

import io
import os
import runpy
import sys
from contextlib import redirect_stdout

import pytest

EXAMPLES = os.path.join(os.path.dirname(os.path.dirname(__file__)), "examples")
QUICKSTART = os.path.join(EXAMPLES, "quickstart.py")


@pytest.fixture(scope="module")
def output() -> str:
    """Run the quickstart once and capture everything it printed."""
    buffer = io.StringIO()
    with redirect_stdout(buffer):
        try:
            runpy.run_path(QUICKSTART, run_name="__main__")
        except SystemExit as exit_code:
            assert exit_code.code == 0
    return buffer.getvalue()


class TestQuickstart:
    def test_the_sample_data_ships_with_the_repository(self):
        assert os.path.exists(os.path.join(EXAMPLES, "data", "trips.csv"))
        assert os.path.exists(os.path.join(EXAMPLES, "data", "drivers.csv"))

    def test_it_registers_both_tables(self, output):
        assert "Registered tables: drivers, trips" in output

    def test_it_prints_the_schema(self, output):
        assert "started_at  timestamp" in output

    def test_every_section_produced_a_grid(self, output):
        headings = [line for line in output.splitlines() if line.startswith("=== ")]
        assert len(headings) >= 7

    def test_the_grouped_query_totals_correctly(self, output):
        assert "| ana    |     4 |   94.95 |" in output

    def test_the_join_keeps_the_written_column_name(self, output):
        assert "| driver | rating | trips |" in output

    def test_the_outer_join_finds_the_unmatched_driver(self, output):
        assert "dara" in output

    def test_the_set_operations_section_pairs_and_subtracts(self, output):
        assert "Cities that are both driven to and lived in" in output
        assert "Cities nobody drives home to" in output

    def test_it_prints_a_plan(self, output):
        assert "Aggregate:" in output

    def test_it_prints_metrics(self, output):
        assert "result.rows" in output
