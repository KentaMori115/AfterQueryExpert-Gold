"""The provider request log."""

from __future__ import annotations

from pathlib import Path

from maingott_reel.config import Settings
from maingott_reel.models import RequestOutcome
from maingott_reel.utils.request_log import RequestLog
from maingott_reel.utils.run_context import RunContext

SECRET = "sk-test-abcdefghijklmnop"


def _log(tmp_path: Path) -> RequestLog:
    return RequestLog(tmp_path / "provider_requests.jsonl", run_id="run-1")


def test_a_request_is_recorded_and_read_back(tmp_path: Path):
    log = _log(tmp_path)
    log.record(
        provider="openai",
        model="sora-2",
        operation="video.generate",
        outcome=RequestOutcome.SUCCESS,
        identity="S-01-video-abc",
        scene_id="S-01",
        prompt_sha256="a" * 64,
        seconds=4.0,
        width=720,
        height=1280,
    )

    records = log.read()
    assert len(records) == 1
    assert records[0].model == "sora-2"
    assert records[0].outcome is RequestOutcome.SUCCESS
    assert records[0].paid


def test_records_append_rather_than_overwrite(tmp_path: Path):
    log = _log(tmp_path)
    for attempt in (1, 2):
        log.record(
            provider="openai",
            model="sora-2",
            operation="video.generate",
            outcome=RequestOutcome.RETRIED,
            attempt=attempt,
            max_attempts=2,
        )
    assert [record.attempt for record in log.read()] == [1, 2]


def test_a_cache_hit_is_never_billed(tmp_path: Path):
    log = _log(tmp_path)
    log.record(
        provider="openai",
        model="sora-2",
        operation="video.generate",
        outcome=RequestOutcome.CACHE_HIT,
    )
    assert log.read()[0].paid is False
    assert log.paid_calls == 0


def test_outcomes_are_distinguishable(tmp_path: Path):
    log = _log(tmp_path)
    for outcome in RequestOutcome:
        log.record(provider="openai", model="sora-2", operation="video.generate", outcome=outcome)
    summary = log.summary()
    assert "5 requests" in summary
    assert "1 from cache" in summary
    assert "1 failed" in summary
    assert log.paid_calls == 4


def test_free_work_is_marked_as_free(tmp_path: Path):
    log = _log(tmp_path)
    log.record(
        provider="fake",
        model="offline-video",
        operation="video.generate",
        outcome=RequestOutcome.SUCCESS,
        paid=False,
    )
    assert log.paid_calls == 0


def test_a_secret_in_a_provider_message_is_redacted(tmp_path: Path):
    log = _log(tmp_path)
    log.record(
        provider="openai",
        model="sora-2",
        operation="video.generate",
        outcome=RequestOutcome.REJECTED,
        detail=f"401 Unauthorized for key {SECRET}",
    )

    assert SECRET not in log.path.read_text(encoding="utf-8")
    assert "REDACTED" in (log.read()[0].detail or "")


def test_an_unreadable_line_does_not_lose_the_rest(tmp_path: Path):
    log = _log(tmp_path)
    log.record(
        provider="openai",
        model="sora-2",
        operation="video.generate",
        outcome=RequestOutcome.SUCCESS,
    )
    with log.path.open("a", encoding="utf-8") as handle:
        handle.write("not json\n")
    log.record(
        provider="openai",
        model="sora-2",
        operation="video.generate",
        outcome=RequestOutcome.FAILED,
    )

    assert len(log.read()) == 2


def test_an_absent_log_reads_as_empty(tmp_path: Path):
    assert _log(tmp_path).read() == []
    assert _log(tmp_path).paid_calls == 0


# --- what the stages record ------------------------------------------------------


def test_asset_generation_records_every_request(settings: Settings, storyboarded_run: RunContext):
    from maingott_reel.assets.manager import generate_assets

    generate_assets(settings, run_id=storyboarded_run.run_id, offline=True)

    records = RequestLog(storyboarded_run.provider_log, storyboarded_run.run_id).read()
    assert len(records) == 8
    assert {record.operation for record in records} == {"video.generate"}
    assert all(record.prompt_sha256 for record in records)
    assert all(record.seconds and record.width and record.height for record in records)
    assert all(not record.paid for record in records), "offline work is never billed"


def test_voice_generation_records_its_request(settings: Settings, storyboarded_run: RunContext):
    from maingott_reel.audio.voice import generate_voice

    generate_voice(settings, run_id=storyboarded_run.run_id, offline=True)

    records = RequestLog(storyboarded_run.provider_log, storyboarded_run.run_id).read()
    assert len(records) == 1
    assert records[0].operation == "audio.speech"
    assert records[0].narration_sha256
    assert records[0].voice == "offline"
    assert records[0].characters


def test_a_cache_hit_is_recorded_as_one(settings: Settings, storyboarded_run: RunContext):
    from maingott_reel.audio.voice import generate_voice

    generate_voice(settings, run_id=storyboarded_run.run_id, offline=True)
    generate_voice(settings, run_id=storyboarded_run.run_id, offline=True, force=True)

    records = RequestLog(storyboarded_run.provider_log, storyboarded_run.run_id).read()
    assert [record.outcome for record in records] == [
        RequestOutcome.SUCCESS,
        RequestOutcome.SUCCESS,
    ]


def test_a_failure_is_recorded(settings: Settings, storyboarded_run: RunContext):
    from maingott_reel.audio.voice import generate_voice
    from maingott_reel.providers.fake import OfflineVoiceProvider, permanent_failure

    generate_voice(
        settings,
        run_id=storyboarded_run.run_id,
        provider=OfflineVoiceProvider(failures=[permanent_failure("refused")]),
    )

    records = RequestLog(storyboarded_run.provider_log, storyboarded_run.run_id).read()
    assert records[-1].outcome is RequestOutcome.REJECTED
    assert "refused" in (records[-1].detail or "")


def test_the_log_never_carries_the_words_or_a_key(settings: Settings, storyboarded_run: RunContext):
    from maingott_reel.audio.voice import generate_voice
    from maingott_reel.models import ScriptPlan
    from maingott_reel.utils.jsonio import read_model

    keyed = settings.model_copy()
    generate_voice(keyed, run_id=storyboarded_run.run_id, offline=True)

    narration = read_model(storyboarded_run.script_json, ScriptPlan).narration
    written = storyboarded_run.provider_log.read_text(encoding="utf-8")
    assert narration not in written
    assert "sk-" not in written
