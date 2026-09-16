from pathlib import Path

from cueforge import compile_production, load_production

ROOT = Path(__file__).resolve().parents[2]


def test_scientific_duration_fixture() -> None:
    loaded = load_production(ROOT / "examples" / "invalid-productions" / "scientific.yaml")
    compiled = compile_production(loaded.value)
    assert not compiled.is_ok
    assert any(item.code == "CF2002" for item in compiled.findings)


def test_self_dependency_fixture() -> None:
    loaded = load_production(ROOT / "examples" / "invalid-productions" / "self_dep.yaml")
    compiled = compile_production(loaded.value)
    assert not compiled.is_ok
    assert any(item.code == "CF3003" for item in compiled.findings)
