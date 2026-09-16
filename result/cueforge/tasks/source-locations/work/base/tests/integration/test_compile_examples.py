from pathlib import Path

from cueforge import compile_production, load_production

ROOT = Path(__file__).resolve().parents[2]


def test_concert_compiles_cleanly() -> None:
    loaded = load_production(ROOT / "examples" / "concert_two_looks.yaml")
    assert loaded.is_ok
    compiled = compile_production(loaded.value)
    assert compiled.is_ok
    assert compiled.value is not None
    starts = {cue.id: cue.start_ms for cue in compiled.value.cues}
    assert starts == {"lx_open": 0, "snd_hit": 2500, "lx_verse": 6500}


def test_cycle_is_rejected_with_witness() -> None:
    loaded = load_production(ROOT / "examples" / "invalid-productions" / "cycle.yaml")
    assert loaded.is_ok
    compiled = compile_production(loaded.value)
    assert not compiled.is_ok
    codes = [item.code for item in compiled.findings]
    assert "CF3002" in codes
    cycle = next(item for item in compiled.findings if item.code == "CF3002")
    assert "a" in cycle.witness["cycle"]


def test_overlap_emits_conflict() -> None:
    loaded = load_production(ROOT / "examples" / "invalid-productions" / "overlap.yaml")
    compiled = compile_production(loaded.value)
    assert compiled.value is not None
    assert any(item.code == "CF4001" for item in compiled.findings)
    assert not compiled.is_ok


def test_glass_harbor_resolves_negative_offsets() -> None:
    loaded = load_production(ROOT / "examples" / "glass_harbor.yaml")
    compiled = compile_production(loaded.value)
    assert compiled.value is not None
    starts = {cue.id: cue.start_ms for cue in compiled.value.cues}
    assert starts["lx_21"] == 59200
    assert starts["auto_07"] == 59400
    assert starts["video_12"] == 58400
    assert starts["mira_cross"] == 59200
    mira = compiled.value.cue_map()["mira_cross"]
    assert mira.duration_ms == 5715


def test_yaml_and_json_same_digest(tmp_path: Path) -> None:
    yaml_text = (ROOT / "examples" / "concert_two_looks.yaml").read_text(encoding="utf-8")
    # Minimal JSON equivalent of concert_two_looks.
    json_path = tmp_path / "concert.json"
    json_path.write_text(
        """
        {
          "version": 1,
          "production": "concert_two_looks",
          "time_unit": "ms",
          "cues": [
            {"id": "lx_open", "department": "lighting", "trigger": {"at": 0}, "duration": 2000,
             "action": {"preset": "house_to_stage"}},
            {"id": "snd_hit", "department": "sound", "trigger": {"after": "lx_open", "offset": 2500},
             "duration": 4000, "action": {"play": "downbeat.wav"}},
            {"id": "lx_verse", "department": "lighting", "trigger": {"after": "snd_hit", "offset": 4000},
             "duration": 8000, "action": {"preset": "verse_wash"}}
          ],
          "assertions": [
            {"expression": "lx_open.completed before snd_hit.started"},
            {"expression": "snd_hit.started before lx_verse.visible"}
          ]
        }
        """,
        encoding="utf-8",
    )
    yaml_show = compile_production(load_production(ROOT / "examples" / "concert_two_looks.yaml").value)
    json_show = compile_production(load_production(json_path).value)
    assert yaml_show.value is not None and json_show.value is not None
    assert yaml_show.value.digest == json_show.value.digest
    assert yaml_text.startswith("version:")
