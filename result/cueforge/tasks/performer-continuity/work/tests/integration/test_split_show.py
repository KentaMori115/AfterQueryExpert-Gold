from pathlib import Path

from cueforge import compile_production, load_production

ROOT = Path(__file__).resolve().parents[2]


def test_split_show_workspace() -> None:
    loaded = load_production(ROOT / "examples" / "split-show")
    assert loaded.is_ok
    compiled = compile_production(loaded.value)
    assert compiled.is_ok
    assert compiled.value is not None
    assert compiled.value.order == ("lx_1",)
    assert compiled.value.cue_map()["lx_1"].uses == ("lamp",)
