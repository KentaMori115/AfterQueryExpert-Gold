from pathlib import Path

from cueforge import compile_production, load_production, rehearse
from cueforge.store.disk import DiskRunStore
from cueforge.store.memory import MemoryRunStore
from cueforge.store.protocol import RunRecord

ROOT = Path(__file__).resolve().parents[2]


def _payload() -> tuple[str, dict[str, object]]:
    loaded = load_production(ROOT / "examples" / "concert_two_looks.yaml")
    compiled = compile_production(loaded.value)
    result = rehearse(compiled.value)
    return result.digest, result.semantic_dict()


def test_memory_cache_hit() -> None:
    digest, payload = _payload()
    store = MemoryRunStore()
    record = RunRecord(digest, "rehearse", payload, {})
    first = store.put(record)
    second = store.put(record)
    assert first.is_ok and second.is_ok
    assert first.value is not None
    fetched = store.get(digest)
    assert fetched.is_ok
    assert fetched.value is not None
    assert fetched.value.digest == digest


def test_memory_conflict() -> None:
    digest, payload = _payload()
    store = MemoryRunStore()
    store.put(RunRecord(digest, "rehearse", payload, {}))
    other = dict(payload)
    other["production_id"] = "tampered"
    result = store.put(RunRecord(digest, "rehearse", other, {}))
    assert not result.is_ok
    assert result.findings[0].code == "CF8002"


def test_disk_round_trip_and_integrity(tmp_path: Path) -> None:
    digest, payload = _payload()
    store = DiskRunStore(tmp_path)
    stored = store.put(RunRecord(digest, "rehearse", payload, {}))
    assert stored.is_ok
    fetched = store.get(digest)
    assert fetched.is_ok
    payload_file = tmp_path / ".cueforge" / "runs" / digest / "payload.json"
    raw = payload_file.read_bytes()
    payload_file.write_bytes(raw[:-2] + b"X\n")
    broken = store.get(digest)
    assert not broken.is_ok
    assert broken.findings[0].code == "CF8001"


def test_missing_run() -> None:
    store = MemoryRunStore()
    result = store.get("abcd")
    assert not result.is_ok
    assert result.findings[0].code == "CF8003"
