"""The public API: the short way in, and the promise that it stays short.

Anything named in ``signalbox.__all__`` is something somebody may have written
into their own code, so it has to keep working. These tests are the contract.
"""

from __future__ import annotations

import signalbox
from signalbox.topology.scheme import Scheme

PLAN = "tests/data/kingsmoor.sbx"


def test_everything_promised_is_there():
    for name in signalbox.__all__:
        assert hasattr(signalbox, name), name


def test_the_promise_is_sorted():
    assert signalbox.__all__ == sorted(signalbox.__all__)


def test_a_plan_can_be_loaded_in_one_call():
    scheme = signalbox.load(PLAN)
    assert isinstance(scheme, Scheme)
    assert scheme.area == "Kingsmoor Junction"


def test_plan_text_can_be_parsed_in_one_call():
    scheme = signalbox.parse(
        "node A boundary\nnode B boundary\n"
        "edge E1 from A to B length 400 direction down\nsection TA over E1\n"
    )
    assert len(scheme.graph.edges) == 1


def test_the_interlocking_can_be_worked_out_in_one_call():
    lock = signalbox.interlocking(signalbox.load(PLAN))
    assert "K1(M)" in lock


def test_the_control_table_can_be_had_in_one_call():
    table = signalbox.control_table(signalbox.load(PLAN))
    assert table.row("K1(M)").entrance == "K1"


def test_the_control_table_takes_an_interlocking_if_you_have_one():
    scheme = signalbox.load(PLAN)
    lock = signalbox.interlocking(scheme)
    assert len(signalbox.control_table(scheme, lock)) == len(lock)


def test_the_rules_can_be_run_in_one_call():
    report = signalbox.check(signalbox.load(PLAN))
    assert report.ran
    assert report.by_rule("flank-open")


def test_checking_takes_an_interlocking_if_you_have_one():
    scheme = signalbox.load(PLAN)
    lock = signalbox.interlocking(scheme)
    assert signalbox.check(scheme, lock).ran


def test_the_errors_are_reachable_from_the_top():
    assert issubclass(signalbox.LayoutError, signalbox.SignalboxError)
    assert issubclass(signalbox.ParseError, signalbox.LayoutError)


def test_a_bad_plan_raises_something_from_the_top(tmp_path):
    import pytest

    bad = tmp_path / "bad.sbx"
    bad.write_text("node A boundary\nedge E1 from A to Z length 10\n")
    with pytest.raises(signalbox.LayoutError):
        signalbox.load(bad)


def test_the_value_types_are_reachable_from_the_top():
    assert signalbox.Distance(100.0).yards > 100
    assert signalbox.Speed.from_mph(60).mph == 60
    assert signalbox.Gradient.parse("1 in 100").per_mille == 10


def test_importing_the_package_does_not_drag_in_the_command_line():
    # In a subprocess, because emptying sys.modules in this one would take the
    # rule registry with it and every test after this would run against nothing.
    import subprocess
    import sys

    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "import signalbox, sys; "
            "assert signalbox.load; "
            "print('cli' if 'signalbox.cli' in sys.modules else 'clean')",
        ],
        capture_output=True,
        text=True,
        cwd="src",
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "clean"


def test_the_docstring_shows_how_to_use_it():
    assert "signalbox.load" in (signalbox.__doc__ or "")
    assert "signalbox.check" in (signalbox.__doc__ or "")
