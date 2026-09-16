from pathlib import Path

from cueforge import compile_production, load_production
from cueforge.api import sheet_for

ROOT = Path(__file__).resolve().parents[2]


def test_master_sheet_orders_by_start_then_id() -> None:
    compiled = compile_production(load_production(ROOT / "examples" / "glass_harbor.yaml").value)
    sheet = sheet_for(compiled.value)
    ids = [row.cue_id for row in sheet.rows]
    assert ids[0] == "video_12"
    assert "lx_21" in ids


def test_department_filter() -> None:
    compiled = compile_production(load_production(ROOT / "examples" / "glass_harbor.yaml").value)
    sheet = sheet_for(compiled.value, "automation")
    assert [row.cue_id for row in sheet.rows] == ["auto_07"]
