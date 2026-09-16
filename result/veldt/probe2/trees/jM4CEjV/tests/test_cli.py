"""Tests for the command line interface."""

from __future__ import annotations

import io
import json
import os

import pytest

from veldt.cli.commands import EXIT_ERROR, EXIT_OK, EXIT_USAGE, build_engine, parse_binding
from veldt.cli.formatting import render_rows, render_schema, render_table
from veldt.cli.main import build_parser, main
from veldt.cli.repl import Repl
from veldt.engine import Engine
from veldt.core.table import Table


def run(argv):
    out, err = io.StringIO(), io.StringIO()
    code = main(argv, out, err)
    return code, out.getvalue(), err.getvalue()


class TestBindings:
    def test_splits_name_and_path(self):
        assert parse_binding("t=/tmp/a.csv") == ("t", "/tmp/a.csv")

    def test_surrounding_space_is_trimmed(self):
        assert parse_binding(" t = /tmp/a.csv ") == ("t", "/tmp/a.csv")

    def test_a_missing_separator_is_rejected(self):
        with pytest.raises(ValueError):
            parse_binding("just-a-path.csv")

    def test_an_empty_half_is_rejected(self):
        with pytest.raises(ValueError):
            parse_binding("=path.csv")

    def test_bindings_register_tables(self, orders_csv):
        engine = build_engine([f"orders={orders_csv}"])
        assert engine.tables() == ["orders"]


class TestRendering:
    def test_the_grid_has_borders_and_a_header(self, orders):
        rendered = render_table(orders)
        assert rendered.startswith("+")
        assert "| id " in rendered

    def test_numbers_are_right_aligned(self, orders):
        assert "|  1 |" in render_table(orders)

    def test_nulls_are_labelled(self, orders):
        assert "NULL" in render_table(orders)

    def test_the_footer_counts_rows(self, orders):
        assert "(6 rows)" in render_table(orders)

    def test_truncation_is_reported(self, orders):
        assert "not shown" in render_table(orders, max_rows=2)

    def test_wide_cells_are_truncated(self):
        table = Table.from_dicts([{"note": "x" * 100}])
        assert "..." in render_table(table, max_width=10)

    def test_an_empty_table_still_renders(self, order_schema):
        assert "(0 rows)" in render_table(Table.empty(order_schema))

    def test_schemas_render_as_a_grid(self, order_schema):
        rendered = render_schema(order_schema, "orders")
        assert rendered.startswith("orders")
        assert "int64" in rendered

    def test_raw_rows_can_be_rendered(self):
        assert "| a " in render_rows([["a", "b"]], ["one", "two"])


class TestQueryCommand:
    def test_prints_a_grid(self, orders_csv):
        code, out, _ = run(["query", "--csv", f"o={orders_csv}", "SELECT id FROM o LIMIT 2"])
        assert code == EXIT_OK
        assert "(2 rows)" in out

    def test_csv_output(self, orders_csv):
        code, out, _ = run(
            ["query", "--csv", f"o={orders_csv}", "--output", "csv", "SELECT id FROM o LIMIT 1"]
        )
        assert out.splitlines() == ["id", "1"]

    def test_json_output(self, orders_csv):
        code, out, _ = run(
            ["query", "--csv", f"o={orders_csv}", "--output", "json", "SELECT id FROM o LIMIT 1"]
        )
        assert json.loads(out.strip()) == {"id": 1}

    def test_max_rows_zero_prints_everything(self, orders_csv):
        code, out, _ = run(
            ["query", "--csv", f"o={orders_csv}", "--max-rows", "0", "SELECT id FROM o"]
        )
        assert "not shown" not in out

    def test_stats_report_the_plan(self, orders_csv):
        code, out, _ = run(
            ["query", "--csv", f"o={orders_csv}", "--stats", "SELECT id FROM o"]
        )
        assert "plan:" in out
        assert "result.rows" in out

    def test_the_optimizer_can_be_disabled(self, orders_csv):
        code, out, _ = run(
            ["query", "--csv", f"o={orders_csv}", "--no-optimize", "SELECT id FROM o LIMIT 1"]
        )
        assert code == EXIT_OK

    def test_jsonl_tables_can_be_bound(self, orders_jsonl):
        code, out, _ = run(
            ["query", "--jsonl", f"o={orders_jsonl}", "SELECT count(*) AS n FROM o"]
        )
        assert "| 6 |" in out

    def test_partitioned_tables_can_be_bound(self, partitioned_root):
        code, out, _ = run(
            ["query", "--partitioned", f"e={partitioned_root}", "SELECT count(*) AS n FROM e"]
        )
        assert "| 5 |" in out

    def test_several_tables_can_be_bound(self, orders_csv, orders_jsonl):
        code, out, _ = run(
            [
                "query",
                "--csv",
                f"a={orders_csv}",
                "--jsonl",
                f"b={orders_jsonl}",
                "SELECT count(*) AS n FROM a CROSS JOIN b",
            ]
        )
        assert "| 36 |" in out


class TestOtherCommands:
    def test_explain_prints_a_plan(self, orders_csv):
        code, out, _ = run(["explain", "--csv", f"o={orders_csv}", "SELECT id FROM o"])
        assert code == EXIT_OK
        assert "Scan" in out

    def test_explain_can_show_the_logical_plan(self, orders_csv):
        code, out, _ = run(
            ["explain", "--csv", f"o={orders_csv}", "--logical", "SELECT id FROM o WHERE id > 1"]
        )
        assert "projection" not in out

    def test_explain_can_annotate_schemas(self, orders_csv):
        code, out, _ = run(
            ["explain", "--csv", f"o={orders_csv}", "--show-schema", "SELECT id FROM o"]
        )
        assert "id:int64" in out

    def test_schema_describes_one_table(self, orders_csv):
        code, out, _ = run(["schema", "--csv", f"o={orders_csv}", "o"])
        assert "customer" in out

    def test_schema_describes_every_table(self, orders_csv):
        code, out, _ = run(["schema", "--csv", f"o={orders_csv}"])
        assert out.startswith("o")

    def test_schema_with_no_tables_says_so(self):
        code, out, _ = run(["schema"])
        assert "no tables" in out

    def test_convert_writes_the_destination(self, tmp_path, orders_csv):
        target = os.path.join(str(tmp_path), "out.jsonl")
        code, out, _ = run(["convert", orders_csv, target])
        assert code == EXIT_OK
        assert "wrote 6 rows" in out
        assert os.path.exists(target)

    def test_version_prints_the_banner(self):
        code, out, _ = run(["version"])
        assert out.startswith("veldt ")

    def test_no_command_prints_help(self):
        code, out, _ = run([])
        assert code == EXIT_USAGE
        assert "usage" in out.lower()


class TestErrorReporting:
    def test_unknown_columns_exit_non_zero(self, orders_csv):
        code, _, err = run(["query", "--csv", f"o={orders_csv}", "SELECT nope FROM o"])
        assert code == EXIT_ERROR
        assert "not found" in err

    def test_unknown_tables_exit_non_zero(self, orders_csv):
        code, _, err = run(["query", "--csv", f"o={orders_csv}", "SELECT id FROM nope"])
        assert code == EXIT_ERROR

    def test_syntax_errors_show_the_offending_line(self, orders_csv):
        code, _, err = run(["query", "--csv", f"o={orders_csv}", "SELECT FROM"])
        assert code == EXIT_ERROR
        assert err.strip()

    def test_a_malformed_binding_is_a_usage_error(self, orders_csv):
        code, _, err = run(["query", "--csv", orders_csv, "SELECT 1 FROM o"])
        assert code == EXIT_USAGE

    def test_a_missing_file_is_reported(self, tmp_path):
        missing = os.path.join(str(tmp_path), "nope.csv")
        code, _, err = run(["query", "--csv", f"o={missing}", "SELECT * FROM o"])
        assert code == EXIT_ERROR

    def test_an_unknown_log_level_is_a_usage_error(self, orders_csv):
        code, _, err = run(
            ["--log-level", "chatty", "query", "--csv", f"o={orders_csv}", "SELECT 1 FROM o"]
        )
        assert code == EXIT_USAGE


class TestParser:
    def test_every_subcommand_is_registered(self):
        parser = build_parser()
        arguments = parser.parse_args(["query", "SELECT 1"])
        assert arguments.command == "query"

    def test_table_options_repeat(self):
        arguments = build_parser().parse_args(
            ["query", "--csv", "a=1.csv", "--csv", "b=2.csv", "SELECT 1"]
        )
        assert len(arguments.csv) == 2


class TestRepl:
    def make(self, engine):
        out, err = io.StringIO(), io.StringIO()
        return Repl(engine, out, err), out, err

    def test_runs_a_terminated_statement(self, engine):
        repl, out, _ = self.make(engine)
        repl.feed("SELECT count(*) AS n FROM orders;")
        assert "| 6 |" in out.getvalue()

    def test_buffers_until_the_semicolon(self, engine):
        repl, out, _ = self.make(engine)
        repl.feed("SELECT count(*) AS n")
        assert "|" not in out.getvalue()
        repl.feed("FROM orders;")
        assert "| 6 |" in out.getvalue()

    def test_lists_tables(self, engine):
        repl, out, _ = self.make(engine)
        repl.feed(".tables")
        assert "orders" in out.getvalue()

    def test_describes_a_table(self, engine):
        repl, out, _ = self.make(engine)
        repl.feed(".schema orders")
        assert "customer" in out.getvalue()

    def test_help_lists_commands(self, engine):
        repl, out, _ = self.make(engine)
        repl.feed(".help")
        assert ".quit" in out.getvalue()

    def test_quit_stops_the_loop(self, engine):
        repl, _, _ = self.make(engine)
        assert repl.feed(".quit") is False

    def test_unknown_dot_commands_are_reported(self, engine):
        repl, _, err = self.make(engine)
        repl.feed(".nope")
        assert "unknown command" in err.getvalue()

    def test_errors_go_to_the_error_stream(self, engine):
        repl, out, err = self.make(engine)
        repl.feed("SELECT nope FROM orders;")
        assert "not found" in err.getvalue()

    def test_reading_from_a_stream_stops_at_the_end(self, engine):
        repl, out, _ = self.make(engine)
        assert repl.run(io.StringIO("SELECT count(*) AS n FROM orders;\n")) == 0
        assert "| 6 |" in out.getvalue()
