"""The ``generate-voice`` stage.

Nothing here needs an API key, a network or paid generation: the offline
provider writes real audio, and failures are scripted.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from maingott_reel.assets.cache import AssetCache
from maingott_reel.audio.voice import (
    VoiceResult,
    build_voice_provider,
    generate_voice,
    voice_capabilities,
    voice_direction,
    voice_provider_identity,
    voice_track,
)
from maingott_reel.audio.wav import parse_wav, tone_samples, write_wav
from maingott_reel.config import Settings
from maingott_reel.creative.draft import DraftShot, StoryboardDraft
from maingott_reel.errors import ConfigurationError, StageNotCompletedError
from maingott_reel.models import (
    AssetStatus,
    AudioFormat,
    Language,
    RunManifest,
    ScriptPlan,
    StageName,
    Storyboard,
    VoiceAsset,
    VoiceFitStrategy,
)
from maingott_reel.providers.fake import (
    OFFLINE_VOICE_NAME,
    OfflineVoiceProvider,
    permanent_failure,
    transient_failure,
)
from maingott_reel.utils.hashing import sha256_text
from maingott_reel.utils.jsonio import read_model, write_model
from maingott_reel.utils.run_context import RunContext


class _LongWinded(OfflineVoiceProvider):
    """An offline provider whose delivery takes a fixed number of seconds."""

    def __init__(self, seconds: float, **kwargs: object) -> None:
        super().__init__(**kwargs)  # type: ignore[arg-type]
        self._seconds = seconds

    def synthesize(self, **kwargs: object) -> object:  # type: ignore[override]
        destination = Path(str(kwargs["destination"]))
        speed = kwargs.get("speed") or 1.0
        seconds = self._seconds / float(speed)  # type: ignore[arg-type]
        self.calls.append({"speed": speed, "seconds": seconds})
        write_wav(destination, tone_samples(seconds, 24000), sample_rate=24000, channels=1)
        from maingott_reel.providers.base import MediaResult, Usage

        return MediaResult(
            path=destination,
            usage=Usage(model=self.model, requests=1),
            duration_seconds=seconds,
            metadata={"offline": True},
        )


def _short_timeline(run: RunContext) -> None:
    """Rescale the run's storyboard to 30 seconds.

    The plan fixture's narration is short, so an overrun only becomes
    realistic against the shortest Reel the project allows.
    """
    from maingott_reel.creative.claims import validate_storyboard
    from maingott_reel.creative.storyboard_generator import build_scenes, build_storyboard

    plan = read_model(run.script_json, ScriptPlan)
    board = read_model(run.storyboard_json, Storyboard)
    shots = _shots_from(board)
    scenes = build_scenes(plan, shots, 30)
    write_model(
        run.storyboard_json,
        build_storyboard(
            scenes=scenes,
            plan=plan,
            target_seconds=30,
            language=board.language,
            validation=validate_storyboard(scenes, plan, 30, created_at=board.created_at),
            provenance=board.provenance,
            created_at=board.created_at,
        ),
    )


def _shots_from(board: Storyboard) -> StoryboardDraft:
    """Rebuild the shot draft a storyboard was made from."""
    return StoryboardDraft(
        shots=[
            DraftShot(
                beat_id=scene.beat_id,
                visual_description=scene.visual_description,
                video_prompt=scene.video_prompt,
                transition=scene.transition.value,
            )
            for scene in board.scenes
        ]
    )


def _reword(run: RunContext) -> str:
    """Change one word of the approved narration, everywhere it appears."""
    plan = read_model(run.script_json, ScriptPlan)
    board = read_model(run.storyboard_json, Storyboard)
    beats = [
        beat.model_copy(update={"narration": beat.narration.replace("соединяет", "связывает")})
        for beat in plan.beats
    ]
    narration = "\n".join(beat.narration for beat in beats)
    write_model(run.script_json, plan.model_copy(update={"beats": beats, "narration": narration}))
    write_model(
        run.storyboard_json,
        board.model_copy(
            update={
                "scenes": [
                    scene.model_copy(
                        update={"voiceover": scene.voiceover.replace("соединяет", "связывает")}
                    )
                    for scene in board.scenes
                ],
                "narration_sha256": sha256_text(narration),
            }
        ),
    )
    return narration


def _generate(settings: Settings, run: RunContext, **kwargs: object) -> VoiceResult:
    return generate_voice(settings, run_id=run.run_id, offline=True, **kwargs)  # type: ignore[arg-type]


# --- offline generation ---------------------------------------------------------


def test_the_offline_provider_produces_a_usable_track(
    settings: Settings, storyboarded_run: RunContext
):
    result = _generate(settings, storyboarded_run)

    assert result.complete
    asset = result.asset
    assert asset is not None
    assert asset.status is AssetStatus.READY
    assert asset.path is not None and asset.path.is_file()
    assert asset.path == storyboarded_run.voice_audio(".wav")
    assert parse_wav(asset.path).frames > 0
    assert asset.duration_seconds and asset.duration_seconds > 0
    assert asset.development is True
    assert asset.passed


def test_the_track_is_bound_to_the_approved_narration(
    settings: Settings, storyboarded_run: RunContext
):
    plan = read_model(storyboarded_run.script_json, ScriptPlan)
    board = read_model(storyboarded_run.storyboard_json, Storyboard)

    asset = _generate(settings, storyboarded_run).asset

    assert asset is not None
    assert asset.narration_sha256 == sha256_text(plan.narration)
    assert asset.narration_sha256 == board.narration_sha256
    assert asset.narration_characters == len(plan.narration)


def test_the_narration_is_never_rewritten(settings: Settings, storyboarded_run: RunContext):
    plan = read_model(storyboarded_run.script_json, ScriptPlan)
    provider = OfflineVoiceProvider()

    generate_voice(settings, run_id=storyboarded_run.run_id, provider=provider)

    assert provider.calls[0]["characters"] == len(plan.narration)


def test_the_artifact_and_the_manifest_are_written(
    settings: Settings, storyboarded_run: RunContext
):
    _generate(settings, storyboarded_run)

    stored = read_model(storyboarded_run.voice_json, VoiceAsset)
    assert stored.is_usable
    manifest = read_model(storyboarded_run.manifest_json, RunManifest)
    assert manifest.stage_completed(StageName.GENERATE_VOICE)
    assert manifest.files["voice"] == storyboarded_run.voice_json
    assert manifest.models.voice == stored.model
    notes = next(
        record.notes for record in manifest.stages if record.stage is StageName.GENERATE_VOICE
    )
    assert stored.narration_sha256[:12] in (notes or "")
    assert "wpm" in (notes or "")


def test_the_measurement_comes_from_the_audio(settings: Settings, storyboarded_run: RunContext):
    asset = _generate(settings, storyboarded_run).asset

    assert asset is not None and asset.metrics is not None
    measured = parse_wav(asset.path).duration_seconds  # type: ignore[arg-type]
    assert asset.metrics.duration_seconds == pytest.approx(measured, abs=0.05)
    assert asset.metrics.words_per_minute > 0
    assert asset.sample_rate == 24000
    assert asset.channels == 1


def test_provenance_records_how_it_was_made(settings: Settings, storyboarded_run: RunContext):
    plan = read_model(storyboarded_run.script_json, ScriptPlan)
    asset = _generate(settings, storyboarded_run).asset

    assert asset is not None
    assert asset.provenance.user_prompt_sha256 == sha256_text(plan.narration)
    assert asset.provenance.provider == "fake"
    assert asset.provenance.model == asset.model
    assert asset.provenance.prompt_version == voice_direction(settings)[1]


# --- resume and cache ------------------------------------------------------------


def test_a_finished_track_is_reused_without_calling_the_provider(
    settings: Settings, storyboarded_run: RunContext
):
    first = _generate(settings, storyboarded_run)
    provider = OfflineVoiceProvider()

    second = generate_voice(settings, run_id=storyboarded_run.run_id, provider=provider)

    assert second.plan.reused
    assert second.plan.generation_count == 0
    assert not provider.calls
    assert second.asset is not None and first.asset is not None
    assert second.asset.id == first.asset.id


def test_the_same_narration_hits_the_cache_in_another_run(
    settings: Settings, storyboarded_run: RunContext, tmp_path: Path
):
    _generate(settings, storyboarded_run)

    second = _clone_run(settings, storyboarded_run, "run-2")
    provider = OfflineVoiceProvider()
    result = generate_voice(settings, run_id=second.run_id, provider=provider)

    assert result.plan.cached
    assert not provider.calls
    assert result.asset is not None
    assert result.asset.cache_hit
    assert result.asset.status is AssetStatus.CACHED
    assert result.asset.path is not None and result.asset.path.is_file()


def _clone_run(settings: Settings, run: RunContext, run_id: str) -> RunContext:
    """Copy a run's Phase 1-3 artifacts into a fresh run directory."""
    from maingott_reel.utils.run_context import create_run

    clone = create_run(settings, run_id=run_id)
    for source, destination in (
        (run.facts_json, clone.facts_json),
        (run.script_json, clone.script_json),
        (run.storyboard_json, clone.storyboard_json),
    ):
        destination.write_bytes(source.read_bytes())
    return clone


def test_a_changed_narration_misses_the_cache(settings: Settings, storyboarded_run: RunContext):
    _generate(settings, storyboarded_run)

    narration = _reword(storyboarded_run)

    provider = OfflineVoiceProvider()
    result = generate_voice(settings, run_id=storyboarded_run.run_id, provider=provider)

    assert not result.plan.reused
    assert not result.plan.cached
    assert provider.calls
    assert result.asset is not None
    assert result.asset.narration_sha256 == sha256_text(narration)


@pytest.mark.parametrize(
    ("field", "value"),
    [("voice_name", "cedar"), ("openai_tts_model", "tts-1-hd"), ("voice_speed", 1.1)],
)
def test_changing_the_voice_configuration_misses_the_cache(
    settings: Settings, storyboarded_run: RunContext, field: str, value: object
):
    from maingott_reel.providers.base import VoiceCapabilities

    wide = VoiceCapabilities(
        supported_voices=(OFFLINE_VOICE_NAME, "cedar"),
        supported_formats=(AudioFormat.WAV,),
        supported_languages=(Language.RU, Language.EN),
        max_input_chars=4096,
        supports_instructions=True,
        supports_speed=True,
        speed_range=(0.25, 4.0),
    )
    generate_voice(
        settings, run_id=storyboarded_run.run_id, provider=OfflineVoiceProvider(capabilities=wide)
    )

    changed = settings.model_copy(update={field: value})
    provider = OfflineVoiceProvider(capabilities=wide, model=str(value))
    result = generate_voice(changed, run_id=storyboarded_run.run_id, provider=provider)

    assert not result.plan.reused
    assert provider.calls


def test_a_corrupted_cache_entry_is_discarded_and_regenerated(
    settings: Settings, storyboarded_run: RunContext
):
    first = _generate(settings, storyboarded_run)
    assert first.asset is not None
    cache = AssetCache(settings.asset_cache_root)
    entry = cache.lookup(first.asset.cache_key)
    assert entry is not None
    entry.path.write_bytes(b"\x00" * 64)

    second = _clone_run(settings, storyboarded_run, "run-3")
    provider = OfflineVoiceProvider()
    result = generate_voice(settings, run_id=second.run_id, provider=provider)

    assert provider.calls, "a corrupted cache entry must not be served"
    assert result.complete


def test_a_deleted_track_is_regenerated(settings: Settings, storyboarded_run: RunContext):
    first = _generate(settings, storyboarded_run)
    assert first.asset is not None and first.asset.path is not None
    first.asset.path.unlink()
    AssetCache(settings.asset_cache_root).discard(first.asset.cache_key)

    provider = OfflineVoiceProvider()
    result = generate_voice(settings, run_id=storyboarded_run.run_id, provider=provider)

    assert provider.calls
    assert result.complete


def test_a_tampered_track_is_regenerated(settings: Settings, storyboarded_run: RunContext):
    first = _generate(settings, storyboarded_run)
    assert first.asset is not None and first.asset.path is not None
    first.asset.path.write_bytes(first.asset.path.read_bytes() + b"\x00\x00")
    AssetCache(settings.asset_cache_root).discard(first.asset.cache_key)

    provider = OfflineVoiceProvider()
    generate_voice(settings, run_id=storyboarded_run.run_id, provider=provider)

    assert provider.calls


def test_force_ignores_the_cache(settings: Settings, storyboarded_run: RunContext):
    _generate(settings, storyboarded_run)
    provider = OfflineVoiceProvider()

    generate_voice(settings, run_id=storyboarded_run.run_id, provider=provider, force=True)

    assert provider.calls


# --- dry run ---------------------------------------------------------------------


def test_a_dry_run_generates_nothing(settings: Settings, storyboarded_run: RunContext):
    result = generate_voice(settings, run_id=storyboarded_run.run_id, dry_run=True)

    assert result.dry_run
    assert result.asset is None
    assert not storyboarded_run.voice_json.exists()
    assert not storyboarded_run.voice_audio(".wav").exists()
    assert result.plan.generation_count == 1
    assert result.plan.cache_state == "generate"
    assert result.plan.estimated_seconds > 0
    assert result.plan.request.narration_sha256


def test_a_dry_run_needs_no_api_key(settings: Settings, storyboarded_run: RunContext):
    assert settings.openai_api_key is None
    result = generate_voice(settings, run_id=storyboarded_run.run_id, dry_run=True)
    assert result.plan.request.provider == "openai"


def test_a_dry_run_reports_a_cache_hit(settings: Settings, storyboarded_run: RunContext):
    _generate(settings, storyboarded_run)
    second = _clone_run(settings, storyboarded_run, "run-4")

    result = generate_voice(settings, run_id=second.run_id, offline=True, dry_run=True)

    assert result.plan.cached
    assert result.plan.cache_state == "cache"
    assert result.plan.generation_count == 0


# --- failures ----------------------------------------------------------------------


def test_a_transient_failure_is_retried(settings: Settings, storyboarded_run: RunContext):
    provider = OfflineVoiceProvider(failures=[transient_failure("outage")])

    result = generate_voice(settings, run_id=storyboarded_run.run_id, provider=provider)

    assert result.complete
    assert result.asset is not None and result.asset.attempts == 2


def test_a_permanent_failure_is_recorded_not_retried(
    settings: Settings, storyboarded_run: RunContext
):
    provider = OfflineVoiceProvider(failures=[permanent_failure("unsupported")])

    result = generate_voice(settings, run_id=storyboarded_run.run_id, provider=provider)

    assert not result.complete
    asset = result.asset
    assert asset is not None
    assert asset.status is AssetStatus.FAILED
    assert "unsupported" in (asset.error or "")
    assert asset.attempts == 1
    assert read_model(storyboarded_run.voice_json, VoiceAsset).status is AssetStatus.FAILED


def test_corrupt_audio_is_never_accepted(settings: Settings, storyboarded_run: RunContext):
    provider = OfflineVoiceProvider(corrupt=True)

    result = generate_voice(settings, run_id=storyboarded_run.run_id, provider=provider)

    assert not result.complete
    assert result.asset is not None
    assert result.asset.status is AssetStatus.FAILED
    assert not storyboarded_run.voice_audio(".wav").exists()


def test_a_failed_run_is_not_cached(settings: Settings, storyboarded_run: RunContext):
    provider = OfflineVoiceProvider(corrupt=True)
    result = generate_voice(settings, run_id=storyboarded_run.run_id, provider=provider)

    assert result.asset is not None
    assert AssetCache(settings.asset_cache_root).lookup(result.asset.cache_key) is None


# --- timing ------------------------------------------------------------------------


def test_narration_that_overruns_the_timeline_fails_by_default(
    settings: Settings, storyboarded_run: RunContext
):
    _short_timeline(storyboarded_run)

    result = generate_voice(
        settings, run_id=storyboarded_run.run_id, provider=_LongWinded(seconds=31.0)
    )

    assert not result.complete
    asset = result.asset
    assert asset is not None
    assert "31" in (asset.error or "")
    assert "VOICE_FIT_STRATEGY=regenerate" in (asset.error or "")
    assert asset.metrics is not None and not asset.metrics.fits_timeline
    # The words are reported, never trimmed.
    assert asset.narration_characters == len(
        read_model(storyboarded_run.script_json, ScriptPlan).narration
    )


def test_the_regenerate_strategy_re_speaks_the_same_words_faster(
    settings: Settings, storyboarded_run: RunContext
):
    _short_timeline(storyboarded_run)
    plan = read_model(storyboarded_run.script_json, ScriptPlan)
    tuned = settings.model_copy(update={"voice_fit_strategy": VoiceFitStrategy.REGENERATE})
    provider = _LongWinded(seconds=31.0)

    result = generate_voice(settings=tuned, run_id=storyboarded_run.run_id, provider=provider)

    assert result.complete
    asset = result.asset
    assert asset is not None
    assert asset.speed is not None and asset.speed > 1.0
    assert asset.transformations and "words are unchanged" in asset.transformations[0]
    assert asset.narration_sha256 == sha256_text(plan.narration)
    assert asset.metrics is not None and asset.metrics.fits_timeline
    assert len(provider.calls) == 2


def test_the_regenerate_strategy_gives_up_rather_than_distorting_speech(
    settings: Settings, storyboarded_run: RunContext
):
    _short_timeline(storyboarded_run)
    tuned = settings.model_copy(
        update={"voice_fit_strategy": VoiceFitStrategy.REGENERATE, "voice_max_speed": 1.05}
    )
    provider = _LongWinded(seconds=36.0)

    result = generate_voice(settings=tuned, run_id=storyboarded_run.run_id, provider=provider)

    assert not result.complete
    assert result.asset is not None
    assert "do not fit" in (result.asset.error or "")
    assert len(provider.calls) == 1


# --- configuration -----------------------------------------------------------------


def test_the_narration_language_is_never_switched_silently(
    settings: Settings, storyboarded_run: RunContext
):
    tuned = settings.model_copy(update={"voice_language": Language.EN})

    with pytest.raises(ConfigurationError, match="never translated"):
        generate_voice(tuned, run_id=storyboarded_run.run_id, offline=True)


def test_a_provider_that_cannot_speak_the_language_fails_clearly(
    settings: Settings, storyboarded_run: RunContext
):
    from maingott_reel.providers.base import VoiceCapabilities

    english_only = VoiceCapabilities(
        supported_voices=(OFFLINE_VOICE_NAME,),
        supported_formats=(AudioFormat.WAV,),
        supported_languages=(Language.EN,),
        max_input_chars=4096,
    )
    provider = OfflineVoiceProvider(capabilities=english_only)

    with pytest.raises(ConfigurationError, match="not configured to narrate"):
        generate_voice(settings, run_id=storyboarded_run.run_id, provider=provider)


def test_narration_longer_than_the_provider_accepts_is_not_shortened(
    settings: Settings, storyboarded_run: RunContext
):
    from maingott_reel.providers.base import VoiceCapabilities

    tiny = VoiceCapabilities(
        supported_voices=(OFFLINE_VOICE_NAME,),
        supported_formats=(AudioFormat.WAV,),
        supported_languages=(Language.RU, Language.EN),
        max_input_chars=50,
    )
    with pytest.raises(ConfigurationError, match="not shortened"):
        generate_voice(
            settings,
            run_id=storyboarded_run.run_id,
            provider=OfflineVoiceProvider(capabilities=tiny),
        )


def test_an_unknown_provider_is_rejected(settings: Settings, storyboarded_run: RunContext):
    tuned = settings.model_copy(update={"voice_provider": "elevenlabs"})
    with pytest.raises(ConfigurationError, match="not implemented"):
        generate_voice(tuned, run_id=storyboarded_run.run_id)


def test_real_generation_needs_credentials(settings: Settings, storyboarded_run: RunContext):
    with pytest.raises(ConfigurationError, match="OPENAI_API_KEY"):
        generate_voice(settings, run_id=storyboarded_run.run_id)


def test_the_real_provider_never_falls_back_to_the_offline_one(settings: Settings):
    with pytest.raises(ConfigurationError):
        build_voice_provider(settings, offline=False)

    provider = build_voice_provider(settings, offline=True)
    assert provider.name == "fake"

    keyed = Settings(
        output_root=settings.output_root, input_root=settings.input_root, openai_api_key="sk-test"
    )
    assert build_voice_provider(keyed, offline=False).name == "openai"


def test_identity_and_capabilities_are_reported_without_credentials(settings: Settings):
    assert voice_provider_identity(settings, offline=False) == (
        "openai",
        "gpt-4o-mini-tts",
        "marin",
    )
    assert voice_provider_identity(settings, offline=True)[0] == "fake"
    assert voice_capabilities(settings, offline=False).max_input_chars == 4096
    assert voice_capabilities(settings, offline=True).supported_voices == (OFFLINE_VOICE_NAME,)


def test_voice_direction_comes_from_the_versioned_prompt(settings: Settings):
    direction, version = voice_direction(settings)
    assert "confident" in direction
    assert version == "2"

    overridden = settings.model_copy(update={"voice_instructions": "Read it plainly."})
    assert voice_direction(overridden) == ("Read it plainly.", "config")


# --- preconditions -------------------------------------------------------------------


def test_a_run_without_a_storyboard_is_refused(settings: Settings, storyboarded_run: RunContext):
    storyboarded_run.storyboard_json.unlink()
    with pytest.raises(StageNotCompletedError, match="storyboard"):
        generate_voice(settings, run_id=storyboarded_run.run_id, offline=True)


def test_a_storyboard_that_no_longer_matches_the_plan_is_refused(
    settings: Settings, storyboarded_run: RunContext
):
    board = read_model(storyboarded_run.storyboard_json, Storyboard)
    write_model(
        storyboarded_run.storyboard_json,
        board.model_copy(update={"narration_sha256": "c" * 64}),
    )
    with pytest.raises(StageNotCompletedError, match="different plan"):
        generate_voice(settings, run_id=storyboarded_run.run_id, offline=True)


def test_the_track_helper_only_returns_usable_narration(
    settings: Settings, storyboarded_run: RunContext
):
    assert voice_track(storyboarded_run) is None

    _generate(settings, storyboarded_run)
    assert voice_track(storyboarded_run) is not None

    failed = read_model(storyboarded_run.voice_json, VoiceAsset).model_copy(
        update={"status": AssetStatus.FAILED, "error": "broken"}
    )
    write_model(storyboarded_run.voice_json, failed)
    assert voice_track(storyboarded_run) is None
