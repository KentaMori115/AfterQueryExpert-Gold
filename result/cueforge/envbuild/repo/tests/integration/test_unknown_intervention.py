from pathlib import Path

from cueforge import compile_production, load_production, rehearse
from cueforge.simulation import DelayCue

ROOT = Path(__file__).resolve().parents[2]


def test_unknown_delay_target() -> None:
    compiled = compile_production(load_production(ROOT / "examples" / "concert_two_looks.yaml").value)
    result = rehearse(compiled.value, [DelayCue("missing", 10)])
    assert any(item.code == "CF7003" for item in result.findings)
