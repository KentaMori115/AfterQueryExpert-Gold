"""Auditioning candidate narration voices."""

from __future__ import annotations

import pytest

from maingott_reel.audio.audition import (
    SAMPLE_MAX_CHARACTERS,
    audition,
    audition_directory,
    candidate_voices,
    sample_text,
)
from maingott_reel.config import Settings
from maingott_reel.errors import BudgetExceededError, ConfigurationError
from maingott_reel.models import ScriptPlan, VoiceAudition
from maingott_reel.providers.fake import OFFLINE_VOICE_CAPABILITIES, OfflineVoiceProvider
from maingott_reel.utils.hashing import sha256_text
from maingott_reel.utils.jsonio import read_model
from maingott_reel.utils.run_context import RunContext


def test_the_sample_is_approved_narration_verbatim(
    settings: Settings, storyboarded_run: RunContext
):
    plan = read_model(storyboarded_run.script_json, ScriptPlan)

    text = sample_text(plan)

    assert text
    assert len(text) <= SAMPLE_MAX_CHARACTERS + len(plan.narration.splitlines()[0])
    for line in text.splitlines():
        assert line in plan.narration, "a candidate reads the approved words, not new ones"
    assert plan.narration.startswith(text.splitlines()[0])


def test_the_sample_never_cuts_a_line_in_half(settings: Settings, storyboarded_run: RunContext):
    plan = read_model(storyboarded_run.script_json, ScriptPlan)
    lines = [line for line in plan.narration.splitlines() if line.strip()]

    assert sample_text(plan).splitlines() == lines[: len(sample_text(plan).splitlines())]


def test_a_plan_without_narration_is_refused(script_plan: ScriptPlan):
    empty = script_plan.model_construct(narration="   ")
    with pytest.raises(ConfigurationError, match="no narration"):
        sample_text(empty)


def test_every_offered_voice_is_auditioned_by_default(settings: Settings):
    assert candidate_voices(settings, OFFLINE_VOICE_CAPABILITIES, None) == list(
        OFFLINE_VOICE_CAPABILITIES.supported_voices
    )


def test_an_unknown_candidate_is_refused(settings: Settings):
    with pytest.raises(ConfigurationError, match="does not offer"):
        candidate_voices(settings, OFFLINE_VOICE_CAPABILITIES, ["nobody"])


def test_an_audition_records_every_candidate(settings: Settings, storyboarded_run: RunContext):
    result = audition(settings, run_id=storyboarded_run.run_id, offline=True)

    assert result.complete
    recorded = result.audition
    assert len(recorded.samples) == len(OFFLINE_VOICE_CAPABILITIES.supported_voices)
    for sample in recorded.samples:
        assert sample.usable
        assert sample.path is not None and sample.path.is_file()
        assert sample.duration_seconds and sample.duration_seconds > 0
        assert sample.sha256
        assert sample.development, "the offline provider is not a voice"
    assert (result.directory / "audition.json").is_file()
    assert read_model(result.directory / "audition.json", VoiceAudition).summary()


def test_an_audition_is_bound_to_the_words_it_read(
    settings: Settings, storyboarded_run: RunContext
):
    plan = read_model(storyboarded_run.script_json, ScriptPlan)

    result = audition(settings, run_id=storyboarded_run.run_id, offline=True)

    assert result.audition.narration_sha256 == sha256_text(plan.narration)
    assert result.audition.sample_sha256 == sha256_text(result.audition.sample_text)
    assert result.directory == audition_directory(settings, result.audition.sample_sha256)


def test_an_audition_never_touches_the_run(settings: Settings, storyboarded_run: RunContext):
    audition(settings, run_id=storyboarded_run.run_id, offline=True)

    assert not storyboarded_run.voice_json.exists()
    assert not storyboarded_run.audio_dir.joinpath("voice.wav").exists()


def test_an_audition_approves_nothing(settings: Settings, storyboarded_run: RunContext):
    audition(settings, run_id=storyboarded_run.run_id, offline=True)

    assert not settings.voice_profile_path.exists(), "a voice is approved by hand, never here"


def test_a_dry_run_records_nothing(settings: Settings, storyboarded_run: RunContext):
    result = audition(settings, run_id=storyboarded_run.run_id, offline=True, dry_run=True)

    assert result.dry_run
    assert not result.audition.samples
    assert not result.directory.exists()
    assert result.plan.planned_calls == len(OFFLINE_VOICE_CAPABILITIES.supported_voices)


def test_named_candidates_narrow_the_field(settings: Settings, storyboarded_run: RunContext):
    result = audition(settings, run_id=storyboarded_run.run_id, offline=True, voices=["offline"])

    assert [sample.voice for sample in result.audition.samples] == ["offline"]


def test_a_failing_candidate_is_recorded_not_hidden(
    settings: Settings, storyboarded_run: RunContext
):
    from maingott_reel.providers.fake import permanent_failure

    provider = OfflineVoiceProvider(failures=[permanent_failure("voice unavailable")])

    result = audition(settings, run_id=storyboarded_run.run_id, provider=provider)

    assert not result.complete
    assert result.audition.failed
    assert "voice unavailable" in (result.audition.failed[0].error or "")


def test_the_audition_respects_the_budget(settings: Settings, storyboarded_run: RunContext):
    class _PaidLooking(OfflineVoiceProvider):
        @property
        def name(self) -> str:
            return "openai"

        @property
        def model(self) -> str:
            return "gpt-4o-mini-tts"

    tuned = settings.model_copy(update={"max_generation_cost": 0.0})

    with pytest.raises(BudgetExceededError):
        audition(tuned, run_id=storyboarded_run.run_id, provider=_PaidLooking())


def test_real_auditioning_needs_credentials(settings: Settings, storyboarded_run: RunContext):
    with pytest.raises(ConfigurationError, match="OPENAI_API_KEY"):
        audition(settings, run_id=storyboarded_run.run_id, voices=["marin"])


def test_the_audition_is_logged_as_a_provider_request(
    settings: Settings, storyboarded_run: RunContext
):
    from maingott_reel.utils.request_log import RequestLog

    audition(settings, run_id=storyboarded_run.run_id, offline=True, voices=["offline"])

    records = RequestLog(storyboarded_run.provider_log, storyboarded_run.run_id).read()
    assert [record.operation for record in records] == ["audio.speech.audition"]
    assert records[0].voice == "offline"
    assert not records[0].paid
