from pathlib import Path

from cueforge import compile_production, load_production
from cueforge.codes import CF1003_PATH_ESCAPE


def test_workspace_merge(tmp_path: Path) -> None:
    (tmp_path / "cueforge.yaml").write_text(
        "version: 1\nproduction: split\ntime_unit: ms\nsources:\n  - cues.yaml\n",
        encoding="utf-8",
    )
    (tmp_path / "cues.yaml").write_text(
        "cues:\n  - id: a\n    department: lighting\n    trigger: {at: 0}\n    duration: 10\n",
        encoding="utf-8",
    )
    loaded = load_production(tmp_path)
    assert loaded.is_ok
    compiled = compile_production(loaded.value)
    assert compiled.is_ok
    assert compiled.value is not None
    assert compiled.value.order == ("a",)


def test_workspace_rejects_parent_escape(tmp_path: Path) -> None:
    (tmp_path / "cueforge.yaml").write_text(
        "version: 1\nproduction: bad\ntime_unit: ms\nsources:\n  - ../outside.yaml\n",
        encoding="utf-8",
    )
    loaded = load_production(tmp_path)
    assert not loaded.is_ok
    assert any(item.code == CF1003_PATH_ESCAPE for item in loaded.findings)


def test_duplicate_resource_across_files(tmp_path: Path) -> None:
    (tmp_path / "cueforge.yaml").write_text(
        "version: 1\nproduction: dup\ntime_unit: ms\nsources:\n  - a.yaml\n  - b.yaml\n",
        encoding="utf-8",
    )
    (tmp_path / "a.yaml").write_text(
        "resources:\n  lamp:\n    kind: light\n    capacity: 1\n",
        encoding="utf-8",
    )
    (tmp_path / "b.yaml").write_text(
        "resources:\n  lamp:\n    kind: light\n    capacity: 1\n"
        "cues:\n  - id: a\n    department: lighting\n    trigger: {at: 0}\n    duration: 1\n",
        encoding="utf-8",
    )
    loaded = load_production(tmp_path)
    assert not loaded.is_ok
    assert any(item.code == "CF1001" for item in loaded.findings)
