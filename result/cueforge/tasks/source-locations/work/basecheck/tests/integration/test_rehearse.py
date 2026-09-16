from pathlib import Path

from cueforge import compile_production, load_production, rehearse
from cueforge.simulation import DelayCue, FailCue, GoCue

ROOT = Path(__file__).resolve().parents[2]


def _compile(name: str):
    loaded = load_production(ROOT / "examples" / name)
    compiled = compile_production(loaded.value)
    assert compiled.value is not None
    return compiled.value


def test_concert_rehearsal_passes_assertions() -> None:
    result = rehearse(_compile("concert_two_looks.yaml"))
    assert not any(item.code.startswith("CF6") for item in result.findings)
    statuses = {item.cue_id: item.status for item in result.statuses}
    assert statuses == {"lx_open": "completed", "snd_hit": "completed", "lx_verse": "completed"}


def test_harbor_rehearsal_passes() -> None:
    result = rehearse(_compile("harbor_rehearsal.yaml"))
    errors = [item for item in result.findings if item.severity == "error"]
    assert errors == []
    assert result.resource_states["revolve"] == "scene_two"


def test_glass_harbor_fails_state_and_assertions() -> None:
    result = rehearse(_compile("glass_harbor.yaml"))
    codes = {item.code for item in result.findings}
    assert "CF4003" in codes
    assert "CF6001" in codes


def test_delay_shifts_dependent() -> None:
    show = _compile("concert_two_looks.yaml")
    result = rehearse(show, [DelayCue("lx_open", 1000)])
    starts = {item.cue_id: item.start_ms for item in result.statuses}
    assert starts["lx_open"] == 1000
    assert starts["snd_hit"] == 3500
    assert starts["lx_verse"] == 7500


def test_fail_at_start_skips_resource() -> None:
    show = _compile("harbor_rehearsal.yaml")
    result = rehearse(show, [FailCue("auto_07")])
    status = next(item for item in result.statuses if item.cue_id == "auto_07")
    assert status.status == "failed"
    assert result.resource_states["revolve"] == "locked"
    assert any(item.code == "CF7002" for item in result.findings)


def test_repeated_rehearse_is_byte_identical() -> None:
    show = _compile("concert_two_looks.yaml")
    first = rehearse(show)
    second = rehearse(show)
    assert first.digest == second.digest
    assert [event.as_dict() for event in first.events] == [event.as_dict() for event in second.events]


def test_manual_go() -> None:
    from cueforge.production.build import production_from_mapping
    from cueforge.compiler.plan import compile_production_document

    data = {
        "version": 1,
        "production": "manual",
        "time_unit": "ms",
        "cues": [
            {"id": "go_lx", "department": "lighting", "trigger": {"manual": True}, "duration": 100},
        ],
    }
    production, findings = production_from_mapping(data, "memory")
    assert production is not None
    assert findings == []
    show, compile_findings = compile_production_document(production)
    assert show is not None
    pending = rehearse(show)
    assert any(item.code == "CF7004" for item in pending.findings)
    fired = rehearse(show, [GoCue("go_lx", 5000)])
    status = fired.statuses[0]
    assert status.start_ms == 5000
    assert status.status == "completed"
    assert compile_findings == ()
