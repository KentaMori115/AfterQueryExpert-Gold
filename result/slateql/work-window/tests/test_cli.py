"""Tests for the command line interface."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from slateql.cli.formatter import format_result
from slateql.cli.main import build_parser, build_session, main
from slateql.cli.repl import Repl
from slateql.errors import ConfigurationError


def run(argv, capsys) -> tuple[int, str]:
    code = main(argv)
    return code, capsys.readouterr().out


def test_parser_exposes_every_subcommand():
    parser = build_parser()
    text = parser.format_help()
    for name in ("query", "explain", "schema", "load", "bench", "functions"):
        assert name in text


def test_query_prints_a_table(capsys, csv_path: Path):
    code, out = run(
        ["--csv", f"sample={csv_path}", "query", "SELECT COUNT(*) AS n FROM sample"],
        capsys,
    )
    assert code == 0
    assert "| n" in out
    assert "(1 row)" in out


def test_query_json_format(capsys, csv_path: Path):
    _, out = run(
        [
            "--csv",
            f"sample={csv_path}",
            "query",
            "SELECT id FROM sample ORDER BY id",
            "--format",
            "json",
        ],
        capsys,
    )
    assert json.loads(out) == [{"id": 1}, {"id": 2}, {"id": 3}]


def test_query_csv_format(capsys, csv_path: Path):
    _, out = run(
        [
            "--csv",
            f"sample={csv_path}",
            "query",
            "SELECT id, label FROM sample ORDER BY id LIMIT 1",
            "--format",
            "csv",
        ],
        capsys,
    )
    assert out.strip().splitlines() == ["id,label", "1,alpha"]


def test_query_reports_timing(capsys, csv_path: Path):
    _, out = run(
        ["--csv", f"sample={csv_path}", "query", "SELECT 1 AS x", "--timing"],
        capsys,
    )
    assert "time:" in out


def test_query_reports_statistics(capsys, csv_path: Path):
    _, out = run(
        [
            "--csv",
            f"sample={csv_path}",
            "query",
            "SELECT COUNT(*) FROM sample",
            "--stats",
        ],
        capsys,
    )
    assert "rows_scanned:" in out


def test_query_from_a_file(capsys, csv_path: Path, tmp_path: Path):
    script = tmp_path / "q.sql"
    script.write_text("SELECT COUNT(*) AS n FROM sample", encoding="utf-8")
    _, out = run(
        ["--csv", f"sample={csv_path}", "query", "-f", str(script)], capsys
    )
    assert "| 3" in out


def test_explain_subcommand(capsys, csv_path: Path):
    _, out = run(
        ["--csv", f"sample={csv_path}", "explain", "SELECT id FROM sample"], capsys
    )
    assert "Scan" in out


def test_explain_without_optimizer(capsys, csv_path: Path):
    _, out = run(
        [
            "--csv",
            f"sample={csv_path}",
            "explain",
            "SELECT id FROM sample WHERE 1 = 1",
            "--no-optimize",
        ],
        capsys,
    )
    assert "Filter" in out


def test_schema_lists_tables(capsys, csv_path: Path):
    _, out = run(["--csv", f"sample={csv_path}", "schema"], capsys)
    assert "sample" in out


def test_schema_describes_one_table(capsys, csv_path: Path):
    _, out = run(["--csv", f"sample={csv_path}", "schema", "sample"], capsys)
    assert "label" in out and "STRING" in out


def test_schema_with_analyze(capsys, csv_path: Path):
    _, out = run(["--csv", f"sample={csv_path}", "schema", "sample", "--analyze"], capsys)
    assert "rows: 3" in out


def test_load_writes_a_file(capsys, csv_path: Path, tmp_path: Path):
    target = tmp_path / "out.csv"
    _, out = run(
        [
            "--csv",
            f"sample={csv_path}",
            "load",
            "sample",
            "--columns",
            "id,label",
            "-o",
            str(target),
        ],
        capsys,
    )
    assert target.read_text(encoding="utf-8").startswith("id,label")
    assert "wrote 3 rows" in out


def test_bench_reports_timings(capsys, csv_path: Path):
    _, out = run(
        ["--csv", f"sample={csv_path}", "bench", "SELECT COUNT(*) FROM sample", "-n", "2"],
        capsys,
    )
    assert "median:" in out and "runs:   2" in out


def test_functions_listing_can_be_filtered(capsys):
    _, out = run(["functions", "upper"], capsys)
    assert "upper" in out
    assert "sqrt" not in out


def test_functions_can_be_restricted_to_aggregates(capsys):
    _, out = run(["functions", "--kind", "aggregate"], capsys)
    assert "count" in out
    assert "| upper" not in out


def test_jsonl_registration(capsys, jsonl_path: Path):
    _, out = run(
        ["--jsonl", f"sample={jsonl_path}", "query", "SELECT COUNT(*) AS n FROM sample"],
        capsys,
    )
    assert "| 3" in out


def test_set_overrides_configuration(capsys, csv_path: Path):
    _, out = run(
        [
            "--csv",
            f"sample={csv_path}",
            "--set",
            "null_ordering=nulls_first",
            "query",
            "SELECT score FROM sample ORDER BY score",
        ],
        capsys,
    )
    assert out.splitlines()[3].strip().startswith("| NULL")


def test_bad_registration_flag_is_reported(capsys):
    code = main(["--csv", "oops", "query", "SELECT 1"])
    assert code == 2
    assert "NAME=VALUE" in capsys.readouterr().err


def test_unknown_configuration_option_is_reported(capsys):
    code = main(["--set", "nope=1", "query", "SELECT 1"])
    assert code == 2


def test_sql_error_is_reported_without_a_traceback(capsys, csv_path: Path):
    code = main(["--csv", f"sample={csv_path}", "query", "SELECT missing FROM sample"])
    assert code == 1
    assert "no such column" in capsys.readouterr().err


def test_unknown_output_format_is_rejected(session):
    with pytest.raises(ConfigurationError):
        format_result(session.sql("SELECT 1 AS x"), "nope")


def test_vertical_format(session):
    text = format_result(session.sql("SELECT 1 AS x"), "vertical")
    assert "RECORD 1" in text


def test_jsonl_output_format(session):
    text = format_result(session.sql("SELECT 1 AS x"), "jsonl")
    assert json.loads(text) == {"x": 1}


def test_repl_executes_statements(session, capsys):
    import io

    stdin = io.StringIO("SELECT 1 AS x;\n\\q\n")
    repl = Repl(session, stdin=stdin)
    assert repl.run() == 0
    out = capsys.readouterr().out
    assert "| x" in out


def test_repl_reports_errors_without_exiting(session, capsys):
    import io

    stdin = io.StringIO("SELECT nope;\nSELECT 2 AS y;\n\\q\n")
    Repl(session, stdin=stdin).run()
    out = capsys.readouterr().out
    assert "error:" in out
    assert "| y" in out


def test_repl_meta_commands(session, capsys):
    import io

    stdin = io.StringIO("\\d\n\\d customers\n\\format csv\n\\timing\n\\q\n")
    Repl(session, stdin=stdin).run()
    out = capsys.readouterr().out
    assert "customers" in out
    assert "output format is now csv" in out
    assert "timing is on" in out


def test_repl_accepts_multiline_statements(session, capsys):
    import io

    stdin = io.StringIO("SELECT 1\n  AS x;\n\\q\n")
    Repl(session, stdin=stdin).run()
    assert "| x" in capsys.readouterr().out


def test_build_session_registers_every_flag(csv_path: Path, jsonl_path: Path):
    parser = build_parser()
    args = parser.parse_args(
        ["--csv", f"a={csv_path}", "--jsonl", f"b={jsonl_path}", "query", "SELECT 1"]
    )
    session = build_session(args)
    assert sorted(session.tables()) == ["a", "b"]
