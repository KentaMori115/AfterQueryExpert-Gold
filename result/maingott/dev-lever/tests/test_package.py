"""Package-level invariants."""

from __future__ import annotations

import importlib
import re
import sys

import pytest

import maingott_reel

MODULES = [
    "maingott_reel",
    "maingott_reel.cli",
    "maingott_reel.config",
    "maingott_reel.errors",
    "maingott_reel.logging_config",
    "maingott_reel.models",
    "maingott_reel.providers",
    "maingott_reel.providers.base",
    "maingott_reel.utils.hashing",
    "maingott_reel.utils.jsonio",
    "maingott_reel.utils.run_context",
]


def test_version_is_exposed():
    assert maingott_reel.__version__ == "0.1.0"


@pytest.mark.parametrize("module_name", MODULES)
def test_modules_import_cleanly(module_name: str):
    assert importlib.import_module(module_name) is not None


def test_importing_the_package_does_not_load_the_openai_sdk():
    # Import the package into a clean module table, then put the original
    # modules back: other tests hold references to these classes, and a second
    # copy of them would fail Pydantic validation.
    saved = {
        name: module
        for name, module in sys.modules.items()
        if name.startswith("maingott_reel") or name == "openai"
    }
    for name in saved:
        del sys.modules[name]
    try:
        importlib.import_module("maingott_reel.cli")
        assert "openai" not in sys.modules, "no module may import the OpenAI SDK at import time"
    finally:
        for name in [n for n in sys.modules if n.startswith("maingott_reel")]:
            del sys.modules[name]
        sys.modules.update(saved)


def test_module_entry_points_run(tmp_path):
    import subprocess

    for module in ("maingott_reel", "maingott_reel.cli"):
        result = subprocess.run(
            [sys.executable, "-m", module, "--version"],
            capture_output=True,
            text=True,
            cwd=tmp_path,
            check=False,
        )
        assert result.returncode == 0, result.stderr
        stdout = re.sub(r"\x1b\[[0-9;]*m", "", result.stdout)
        assert maingott_reel.__version__ in stdout
