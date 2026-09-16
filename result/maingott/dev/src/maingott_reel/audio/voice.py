"""The ``generate-voice`` stage.

Speaks the narration the planner approved, and only that. The script is
authoritative: this stage never rewrites, shortens, translates or embellishes
a word of it, and the audio it produces carries the hash of the exact text it
spoke so composition can refuse a track that belongs to a different script.

Like the asset stage, narration is content-addressed and cached, so the same
words in the same voice are paid for once and reused by every later run.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

import orjson
from pydantic import ValidationError

from maingott_reel.assets.cache import AssetCache
from maingott_reel.assets.manager import check_inputs as check_upstream
from maingott_reel.audio.identity import VoiceRequest
from maingott_reel.audio import takes as take_stage
from maingott_reel.audio.probe import AudioInfo, AudioProbe, default_audio_probe
from maingott_reel.audio.validation import (
    expected_rate,
    failure_summary,
    fit_speed,
    speech_metrics,
    validate_voice_file,
)
from maingott_reel.config import Settings
from maingott_reel.errors import (
    ConfigurationError,
    ProviderError,
    StageNotCompletedError,
    TransientProviderError,
)
from maingott_reel.logging_config import get_logger
from maingott_reel.models import (
    VOICE_VERSION,
    AssetStatus,
    FactRegistry,
    GenerationKind,
    GenerationProvenance,
    Language,
    RequestOutcome,
    ScriptPlan,
    SpeechMetrics,
    StageName,
    Storyboard,
    ValidationReport,
    VoiceAsset,
    VoiceFitStrategy,
    VoiceTakes,
)
from maingott_reel.providers.base import VoiceCapabilities, VoiceProvider
from maingott_reel.utils.hashing import sha256_file, sha256_text
from maingott_reel.utils.jsonio import read_model, write_model
from maingott_reel.utils.manifest_store import load_or_create_manifest, save_manifest
from maingott_reel.utils.prompts import load_prompt
from maingott_reel.utils.request_log import RequestLog
from maingott_reel.utils.run_context import RunContext, resolve_run

logger = get_logger("audio.voice")

#: The versioned voice direction sent to a steerable speech model.
VOICE_PROMPT = "voice/narration"

#: The offline provider's name. Work attributed to it is never billed.
FAKE_PROVIDER_NAME = "fake"

#: Checks that say the narration does not fit its timeline, rather than that
#: the audio is broken. A file that fails only these is still worth caching.
TIMING_CHECKS = ("narration_fits_the_timeline", "speech_rate_is_reasonable")


@dataclass(frozen=True)
class VoicePlan:
    """What ``generate-voice`` would do, before it does anything."""

    request: VoiceRequest
    capabilities: VoiceCapabilities
    reused: bool = False
    cached: bool = False
    previous: VoiceAsset | None = None
    takes: tuple[take_stage.TakeSlot, ...] = ()

    @property
    def needs_generation(self) -> bool:
        """Whether the provider has to be called."""
        return not (self.reused or self.cached)

    @property
    def generation_count(self) -> int:
        """How many paid calls this plan implies.

        One per distinct take: two scenes saying the same words at the same
        speed are one piece of narration and are paid for once.
        """
        if not self.needs_generation:
            return 0
        if not self.takes:
            return 1
        return len({slot.request.cache_key for slot in self.takes})

    @property
    def estimated_seconds(self) -> float:
        """How long the narration should take to speak, at the expected rate."""
        rate = expected_rate(self.request.language) * (self.request.speed or 1.0)
        return round(self.request.characters / rate, 2)

    @property
    def cache_state(self) -> str:
        """``reuse``, ``cache`` or ``generate``."""
        if self.reused:
            return "reuse"
        return "cache" if self.cached else "generate"


@dataclass(frozen=True)
class VoiceResult:
    """What the stage produced."""

    run: RunContext
    plan: VoicePlan
    asset: VoiceAsset | None
    dry_run: bool

    @property
    def complete(self) -> bool:
        """Whether a usable narration track exists."""
        return self.asset is not None and self.asset.is_usable

    @property
    def development(self) -> bool:
        """Whether the narration is a placeholder rather than a voice."""
        return self.asset is not None and self.asset.development


@dataclass(frozen=True)
class _Attempt:
    """One synthesis attempt, before it becomes a record."""

    request: VoiceRequest
    path: Path | None = None
    report: ValidationReport | None = None
    info: AudioInfo | None = None
    metrics: SpeechMetrics | None = None
    metadata: dict[str, object] = field(default_factory=dict)
    cached: bool = False
    attempts: int = 0
    error: str | None = None

    @property
    def passed(self) -> bool:
        """Whether the track is usable as it stands."""
        return self.report is not None and self.report.passed

    @property
    def audio_is_sound(self) -> bool:
        """Whether the file is real, correct audio, timing aside."""
        if self.report is None:
            return False
        return not [check for check in self.report.failures if check.name not in TIMING_CHECKS]


# --- loading and preconditions ---------------------------------------------


def load_upstream(run: RunContext) -> tuple[Storyboard, ScriptPlan, FactRegistry]:
    """Load the approved artifacts this stage — and cost planning — depend on.

    Raises:
        StageNotCompletedError: an artifact is missing or unreadable.
    """
    run.require(run.storyboard_json, "storyboard")
    run.require(run.script_json, "plan")
    run.require(run.facts_json, "analyze")
    try:
        return (
            read_model(run.storyboard_json, Storyboard),
            read_model(run.script_json, ScriptPlan),
            read_model(run.facts_json, FactRegistry),
        )
    except (ValidationError, orjson.JSONDecodeError, OSError) as error:
        raise StageNotCompletedError(
            f"Run {run.run_id} has unreadable artifacts ({error}). Re-run the earlier stages."
        ) from error


# --- voice direction ---------------------------------------------------------


def voice_direction(settings: Settings) -> tuple[str, str]:
    """Return the voice direction and the version it came from.

    Delivery is configuration, not business logic: the direction is either the
    versioned prompt shipped with the project or an explicit override from the
    environment. Neither may contain the words to be spoken.

    Raises:
        ConfigurationError: the prompt file is missing or empty.
    """
    if settings.voice_instructions is not None:
        return settings.voice_instructions.strip(), "config"
    template = load_prompt(VOICE_PROMPT, settings.prompts_root)
    return template.body, template.version


# --- provider selection ------------------------------------------------------


def voice_provider_identity(settings: Settings, offline: bool) -> tuple[str, str, str]:
    """Return the provider name, model and voice that will be used."""
    if offline:
        from maingott_reel.providers.fake import (
            FAKE_PROVIDER_NAME,
            OFFLINE_VOICE_MODEL,
            OFFLINE_VOICE_NAME,
        )

        return FAKE_PROVIDER_NAME, OFFLINE_VOICE_MODEL, OFFLINE_VOICE_NAME
    return settings.voice_provider, settings.openai_tts_model, settings.voice_name


def voice_capabilities(settings: Settings, offline: bool) -> VoiceCapabilities:
    """Return the capabilities of the provider that will be used.

    Reading capabilities never needs credentials, so a dry run works without
    an API key.

    Raises:
        ConfigurationError: the configured provider is unknown.
    """
    if offline:
        from maingott_reel.providers.fake import OFFLINE_VOICE_CAPABILITIES

        return OFFLINE_VOICE_CAPABILITIES
    if settings.voice_provider != "openai":
        raise ConfigurationError(
            f"VOICE_PROVIDER '{settings.voice_provider}' is not implemented. "
            "Use 'openai', or run with --offline."
        )
    from maingott_reel.providers.openai_provider import STEERABLE_TTS_MODELS, TTS_CAPABILITIES

    if settings.openai_tts_model in STEERABLE_TTS_MODELS:
        return TTS_CAPABILITIES
    from dataclasses import replace

    return replace(TTS_CAPABILITIES, supports_instructions=False)


def build_voice_provider(settings: Settings, offline: bool) -> VoiceProvider:
    """Construct the provider that will actually be called.

    Raises:
        ConfigurationError: the real provider is selected without a key, or
            the configured provider is unknown.
    """
    if offline:
        from maingott_reel.providers.fake import OfflineVoiceProvider

        return OfflineVoiceProvider()
    if settings.voice_provider != "openai":
        raise ConfigurationError(
            f"VOICE_PROVIDER '{settings.voice_provider}' is not implemented. "
            "Use 'openai', or run with --offline."
        )
    from maingott_reel.providers.openai_provider import OpenAIVoiceProvider

    return OpenAIVoiceProvider(settings)


# --- planning ------------------------------------------------------------------


def build_request(
    settings: Settings,
    storyboard: Storyboard,
    plan: ScriptPlan,
    registry: FactRegistry,
    run: RunContext,
    capabilities: VoiceCapabilities,
    provider_name: str,
    model: str,
    voice_name: str,
    instructions: str,
    prompt_version: str,
) -> VoiceRequest:
    """Resolve the approved narration into a generatable request.

    Raises:
        ConfigurationError: the provider cannot speak this narration in this
            language, voice or format.
    """
    language = _resolve_language(settings, plan)
    audio_format = settings.voice_format
    if language not in capabilities.supported_languages:
        raise ConfigurationError(
            f"{provider_name}:{model} is not configured to narrate in '{language.value}'. "
            f"It supports {', '.join(item.value for item in capabilities.supported_languages)}. "
            "Change the voice provider, not the narration."
        )
    if not capabilities.supports_voice(voice_name):
        raise ConfigurationError(
            f"{provider_name}:{model} does not offer the voice '{voice_name}'. "
            f"Available: {', '.join(capabilities.supported_voices)}."
        )
    if audio_format not in capabilities.supported_formats:
        raise ConfigurationError(
            f"{provider_name}:{model} cannot return {audio_format.value}. "
            f"Available: {', '.join(item.value for item in capabilities.supported_formats)}."
        )
    if len(plan.narration) > capabilities.max_input_chars:
        raise ConfigurationError(
            f"The approved narration is {len(plan.narration)} characters; "
            f"{model} accepts {capabilities.max_input_chars}. The narration is not shortened "
            "here — re-plan a shorter script."
        )
    if not capabilities.supports_speed_value(settings.voice_speed):
        low, high = capabilities.speed_range
        raise ConfigurationError(
            f"{provider_name}:{model} accepts speaking speeds between {low} and {high}, "
            f"not {settings.voice_speed}."
        )

    return VoiceRequest(
        narration=plan.narration,
        provider=provider_name,
        model=model,
        voice=voice_name,
        language=language,
        audio_format=audio_format,
        storyboard_sha256=sha256_file(run.storyboard_json),
        source_sha256=registry.source_sha256,
        target_duration_seconds=storyboard.total_duration_seconds,
        speed=settings.voice_speed,
        instructions=instructions if capabilities.supports_instructions else None,
        prompt_version=prompt_version,
        settings={"generation_version": VOICE_VERSION},
    )


def _resolve_language(settings: Settings, plan: ScriptPlan) -> Language:
    """Return the narration language, refusing to translate it.

    Raises:
        ConfigurationError: the configuration asks for a different language
            than the approved plan is written in.
    """
    if settings.voice_language is not None and settings.voice_language is not plan.language:
        raise ConfigurationError(
            f"VOICE_LANGUAGE is '{settings.voice_language.value}' but the approved plan is in "
            f"'{plan.language.value}'. The narration is never translated here — re-plan in the "
            "language you want to hear."
        )
    return plan.language


def _existing_voice(run: RunContext) -> VoiceAsset | None:
    """Load the track a previous run of this stage produced."""
    if not run.voice_json.is_file():
        return None
    try:
        return read_model(run.voice_json, VoiceAsset)
    except (ValidationError, orjson.JSONDecodeError, OSError) as error:
        logger.warning("existing voice.json is unreadable", extra={"error": str(error)})
        return None


def _still_usable(asset: VoiceAsset, request: VoiceRequest) -> bool:
    """Whether an existing track can be reused as it stands."""
    if not asset.is_usable or asset.path is None or asset.sha256 is None:
        return False
    if asset.cache_key != request.cache_key:
        return False
    if asset.narration_sha256 != request.narration_sha256:
        logger.info("the approved narration changed since the last voice generation")
        return False
    if not asset.path.is_file():
        logger.warning("the generated narration is missing", extra={"voice": asset.id})
        return False
    if sha256_file(asset.path) != asset.sha256:
        logger.warning("the generated narration changed on disk", extra={"voice": asset.id})
        return False
    return True


def plan_voice(
    run: RunContext,
    request: VoiceRequest,
    capabilities: VoiceCapabilities,
    cache: AssetCache,
    force: bool = False,
    take_slots: Sequence[take_stage.TakeSlot] = (),
) -> VoicePlan:
    """Work out what has to be generated, without generating anything."""
    previous = _existing_voice(run)
    reusable = not force and previous is not None and _still_usable(previous, request)
    if reusable and previous is not None and not _takes_still_match(previous, take_slots):
        # The words are the same but the scenes they have to fit are not.
        logger.info("the storyboard's scenes moved since the last narration")
        reusable = False
    if take_slots:
        keys = {slot.request.cache_key for slot in take_slots}
        cached = not force and not reusable and all(cache.lookup(key) is not None for key in keys)
    else:
        cached = not force and not reusable and cache.lookup(request.cache_key) is not None
    return VoicePlan(
        request=request,
        capabilities=capabilities,
        reused=reusable,
        cached=cached,
        previous=previous,
        takes=tuple(take_slots),
    )


def _takes_still_match(asset: VoiceAsset, take_slots: Sequence[take_stage.TakeSlot]) -> bool:
    """Whether a stored track was cut the way the storyboard now asks for.

    Rescaling a storyboard leaves the words alone and moves every scene, so a
    track whose takes sit at the old instants is no longer this Reel's
    narration even though it speaks the right script.
    """
    stored = [(take.scene_id, take.start_seconds, take.scene_seconds) for take in asset.takes]
    wanted = [(slot.scene_id, slot.start_seconds, slot.scene_seconds) for slot in take_slots]
    return stored == wanted


# --- generation ------------------------------------------------------------------


def _attempt(
    request: VoiceRequest,
    destination: Path,
    provider: VoiceProvider,
    cache: AssetCache,
    probe: AudioProbe,
    expected_narration_sha256: str,
    max_attempts: int,
    use_cache: bool = True,
    log: RequestLog | None = None,
    paid: bool = True,
) -> _Attempt:
    """Produce the audio once, from the cache or the provider, and check it."""

    def _record(outcome: RequestOutcome, attempt: int, detail: str | None = None) -> None:
        """Note what was asked of the provider, without any credential in it."""
        if log is None:
            return
        log.record(
            provider=request.provider,
            model=request.model,
            operation="audio.speech",
            outcome=outcome,
            paid=paid and outcome is not RequestOutcome.CACHE_HIT,
            identity=request.voice_id,
            narration_sha256=request.narration_sha256,
            voice=request.voice,
            language=request.language.value,
            speed=request.speed,
            characters=request.characters,
            attempt=attempt,
            max_attempts=max_attempts,
            detail=detail,
        )

    entry = cache.lookup(request.cache_key) if use_cache else None
    if entry is not None:
        cache.copy_into(entry, destination)
        report, info = validate_voice_file(destination, request, probe, expected_narration_sha256)
        if not [check for check in report.failures if check.name not in TIMING_CHECKS]:
            logger.info("narration served from cache", extra=request.describe())
            _record(RequestOutcome.CACHE_HIT, attempt=1, detail="served from the asset cache")
            return _Attempt(
                request=request,
                path=destination,
                report=report,
                info=info,
                metrics=speech_metrics(request, info.duration_seconds) if info else None,
                metadata={"cache_key": request.cache_key},
                cached=True,
                attempts=0,
            )
        logger.warning(
            "cached narration failed validation, regenerating",
            extra={"voice": request.voice_id, "detail": failure_summary(report)},
        )
        cache.discard(request.cache_key)

    last_error = "generation was never attempted"
    for attempt in range(1, max_attempts + 1):
        try:
            result = provider.synthesize(
                text=request.spoken_text,
                voice=request.voice,
                language=request.language,
                audio_format=request.audio_format,
                destination=destination,
                instructions=request.instructions,
                speed=request.speed,
            )
        except TransientProviderError as error:
            last_error = str(error)
            logger.warning(
                "narration failed, retrying",
                extra={"voice": request.voice_id, "attempt": attempt, "error": last_error},
            )
            _record(RequestOutcome.RETRIED, attempt, last_error)
            continue
        except (ProviderError, ConfigurationError) as error:
            # Not worth retrying: the request itself is unacceptable.
            logger.error("narration failed", extra={"voice": request.voice_id, "error": str(error)})
            _record(RequestOutcome.REJECTED, attempt, str(error))
            return _Attempt(request=request, attempts=attempt, error=str(error))

        report, info = validate_voice_file(destination, request, probe, expected_narration_sha256)
        sound = not [check for check in report.failures if check.name not in TIMING_CHECKS]
        if not sound:
            last_error = failure_summary(report)
            logger.warning(
                "generated narration failed validation",
                extra={"voice": request.voice_id, "attempt": attempt, "detail": last_error},
            )
            _record(RequestOutcome.FAILED, attempt, last_error)
            destination.unlink(missing_ok=True)
            continue

        cache.store(request.cache_key, destination, request.describe())
        logger.info(
            "narration generated",
            extra={**request.describe(), "attempt": attempt, "usage_model": result.usage.model},
        )
        _record(RequestOutcome.SUCCESS, attempt)
        return _Attempt(
            request=request,
            path=destination,
            report=report,
            info=info,
            metrics=speech_metrics(request, info.duration_seconds) if info else None,
            metadata=dict(result.metadata),
            cached=False,
            attempts=attempt,
        )

    _record(RequestOutcome.FAILED, max_attempts, f"gave up after {max_attempts} attempts")
    return _Attempt(
        request=request,
        attempts=max_attempts,
        error=f"after {max_attempts} attempts: {last_error}",
    )


def _fitting_speed(
    attempt: _Attempt, settings: Settings, capabilities: VoiceCapabilities
) -> float | None:
    """Return a supported speaking speed that would fit, or ``None``.

    The narration is never shortened to fit the Reel: the only lever here is
    how fast the same words are spoken, and only inside configured bounds.
    """
    if attempt.metrics is None or not capabilities.supports_speed:
        return None
    required = fit_speed(attempt.metrics.duration_seconds, attempt.metrics.timeline_seconds)
    required *= attempt.request.speed or 1.0
    low = max(settings.voice_min_speed, capabilities.speed_range[0])
    high = min(settings.voice_max_speed, capabilities.speed_range[1])
    if required > high or required < low:
        return None
    return round(required, 3)


def _generate(
    request: VoiceRequest,
    run: RunContext,
    provider: VoiceProvider,
    capabilities: VoiceCapabilities,
    cache: AssetCache,
    probe: AudioProbe,
    settings: Settings,
    expected_narration_sha256: str,
    prompt_version: str,
    source_sha256: str,
    development: bool,
    use_cache: bool = True,
    log: RequestLog | None = None,
    paid: bool = True,
) -> VoiceAsset:
    """Produce the narration, at most one fitting regeneration deep."""
    destination = run.voice_audio(request.audio_format.suffix)
    transformations: list[str] = []
    current = request
    attempt = _attempt(
        current,
        destination,
        provider,
        cache,
        probe,
        expected_narration_sha256,
        settings.voice_max_attempts,
        use_cache=use_cache,
        log=log,
        paid=paid,
    )

    if (
        attempt.audio_is_sound
        and attempt.metrics is not None
        and not attempt.metrics.fits_timeline
        and settings.voice_fit_strategy is VoiceFitStrategy.REGENERATE
    ):
        speed = _fitting_speed(attempt, settings, capabilities)
        if speed is None:
            attempt = _too_long(attempt, settings, capabilities)
        else:
            logger.info(
                "narration overruns the timeline, regenerating at a supported speed",
                extra={"voice": current.voice_id, "speed": speed},
            )
            transformations.append(
                f"regenerated at speaking speed {speed} to fit the "
                f"{current.target_duration_seconds}s timeline; the words are unchanged"
            )
            current = current.with_speed(speed)
            attempt = _attempt(
                current,
                destination,
                provider,
                cache,
                probe,
                expected_narration_sha256,
                settings.voice_max_attempts,
                use_cache=use_cache,
                log=log,
                paid=paid,
            )

    if attempt.audio_is_sound and attempt.metrics is not None and not attempt.metrics.fits_timeline:
        attempt = _too_long(attempt, settings, capabilities)

    return _record(
        attempt=attempt,
        run=run,
        prompt_version=prompt_version,
        source_sha256=source_sha256,
        development=development,
        transformations=transformations,
    )


def _generate_takes(
    request: VoiceRequest,
    cut: Sequence[take_stage.TakeSlot],
    run: RunContext,
    provider: VoiceProvider,
    capabilities: VoiceCapabilities,
    cache: AssetCache,
    probe: AudioProbe,
    settings: Settings,
    expected_narration_sha256: str,
    prompt_version: str,
    source_sha256: str,
    development: bool,
    total_seconds: float,
    use_cache: bool = True,
    log: RequestLog | None = None,
    paid: bool = True,
) -> VoiceAsset:
    """Speak the Reel scene by scene and lay the takes onto its timeline."""
    take_stage.check_assemblable(request.audio_format)
    generated: set[str] = set()

    def speak(one: VoiceRequest, destination: Path, may_cache: bool) -> _Attempt:
        return _attempt(
            one,
            destination,
            provider,
            cache,
            probe,
            sha256_text(one.narration),
            settings.voice_max_attempts,
            use_cache=may_cache,
            log=log,
            paid=paid,
        )

    spoken = take_stage.speak_round(cut, speak, run.take_audio, generated, use_cache=use_cache)
    transformations: list[str] = []

    if spoken.sound and spoken.overrunning:
        if settings.voice_fit_strategy is VoiceFitStrategy.REGENERATE:
            speed = take_stage.shared_speed(spoken)
            if take_stage.speed_is_available(
                speed, capabilities, settings.voice_min_speed, settings.voice_max_speed
            ):
                logger.info(
                    "narration overruns its scenes, re-speaking the Reel at one speed",
                    extra={"speed": speed, "scenes": len(spoken.overrunning)},
                )
                transformations.append(
                    f"every take re-spoken at speaking speed {speed} so each one fits its own "
                    "scene; the words are unchanged"
                )
                spoken = take_stage.speak_round(
                    take_stage.at_speed(cut, speed),
                    speak,
                    run.take_audio,
                    generated,
                    use_cache=use_cache,
                )
            else:
                spoken.error = (
                    f"the narration would have to be spoken at {speed} to fit every scene, "
                    f"outside {settings.voice_min_speed}-{settings.voice_max_speed}. "
                    "Re-plan shorter lines or lengthen the Reel."
                )
        else:
            spoken.error = (
                f"narration overruns its scenes: {take_stage.overrun_summary(spoken)}. "
                "Re-plan shorter lines, lengthen the Reel, or set VOICE_FIT_STRATEGY=regenerate "
                "to re-speak the same words faster."
            )

    if spoken.sound and spoken.overrunning:
        spoken.error = spoken.error or (
            f"even re-spoken, narration overruns its scenes: {take_stage.overrun_summary(spoken)}. "
            "Re-plan shorter lines or lengthen the Reel."
        )

    if not spoken.sound:
        return _record_takes(
            request=request,
            spoken=spoken,
            run=run,
            prompt_version=prompt_version,
            source_sha256=source_sha256,
            development=development,
            transformations=transformations,
            report=None,
            info=None,
            path=None,
        )

    path = take_stage.assemble(spoken, total_seconds, run.voice_audio(request.audio_format.suffix))
    report, info = validate_voice_file(
        path,
        request,
        probe,
        expected_narration_sha256,
        spoken_seconds=spoken.spoken_seconds,
    )
    return _record_takes(
        request=request,
        spoken=spoken,
        run=run,
        prompt_version=prompt_version,
        source_sha256=source_sha256,
        development=development,
        transformations=transformations,
        report=report,
        info=info,
        path=path if report.passed else None,
    )


def _record_takes(
    request: VoiceRequest,
    spoken: take_stage.TakeRound,
    run: RunContext,
    prompt_version: str,
    source_sha256: str,
    development: bool,
    transformations: list[str],
    report: ValidationReport | None,
    info: AudioInfo | None,
    path: Path | None,
) -> VoiceAsset:
    """Build the persisted record for a scene-by-scene track."""
    provenance = GenerationProvenance(
        generator_version=VOICE_VERSION,
        prompt_version=prompt_version,
        system_prompt_sha256=sha256_text(request.instructions or ""),
        user_prompt_sha256=request.narration_sha256,
        provider=request.provider,
        model=request.model,
        generated_at=datetime.now(tz=UTC),
        source_sha256=source_sha256,
        attempts=1,
    )
    usable = path is not None and report is not None and report.passed and spoken.error is None
    recorded = [take.record() for take in spoken.takes if take.duration_seconds > 0]
    error = spoken.error
    if not usable and error is None:
        error = (
            failure_summary(report)
            if report is not None
            else "the narration did not pass validation"
        ) or "the narration did not pass validation"
    metrics = (
        speech_metrics(request, spoken.spoken_seconds, spoken.spoken_seconds) if usable else None
    )
    return VoiceAsset(
        id=request.voice_id,
        status=AssetStatus.READY if usable else AssetStatus.FAILED,
        created_at=datetime.now(tz=UTC),
        provider=request.provider,
        model=request.model,
        voice=request.voice,
        language=request.language,
        audio_format=request.audio_format,
        speed=recorded[-1].speed if recorded else request.speed,
        instructions=request.instructions,
        instructions_sha256=request.instructions_sha256,
        cache_key=request.cache_key,
        narration_sha256=request.narration_sha256,
        narration_characters=request.characters,
        storyboard_sha256=request.storyboard_sha256,
        target_duration_seconds=request.target_duration_seconds,
        path=path,
        sha256=sha256_file(path) if path else None,
        size_bytes=path.stat().st_size if path else None,
        duration_seconds=info.duration_seconds if info and usable else None,
        sample_rate=info.sample_rate if info else None,
        channels=info.channels if info else None,
        codec=info.codec if info else None,
        metrics=metrics,
        attempts=1,
        cache_hit=bool(recorded) and all(take.cache_hit for take in recorded),
        development=development,
        transformations=transformations,
        takes=recorded,
        generation_metadata={"takes": len(recorded)},
        validation=report,
        provenance=provenance,
        error=error,
    )


def _too_long(attempt: _Attempt, settings: Settings, capabilities: VoiceCapabilities) -> _Attempt:
    """Turn an overrunning take into a clear failure.

    The narration is approved wording. If it cannot be spoken inside the
    storyboard's timeline, that is reported — it is never trimmed, and the
    script is never rewritten to make it fit.
    """
    assert attempt.metrics is not None  # only called when the take was measured
    metrics = attempt.metrics
    remedy = (
        "Re-plan a shorter script, lengthen the Reel, or set VOICE_FIT_STRATEGY=regenerate "
        f"to re-speak the same words between {settings.voice_min_speed} and "
        f"{settings.voice_max_speed} speed."
        if settings.voice_fit_strategy is VoiceFitStrategy.FAIL
        else "Even at the fastest configured speaking speed the same words do not fit. "
        "Re-plan a shorter script or lengthen the Reel."
    )
    if not capabilities.supports_speed:
        remedy = (
            f"{attempt.request.provider}:{attempt.request.model} offers no speaking-speed "
            "control. Re-plan a shorter script or lengthen the Reel."
        )
    return _Attempt(
        request=attempt.request,
        path=attempt.path,
        report=attempt.report,
        info=attempt.info,
        metrics=attempt.metrics,
        metadata=attempt.metadata,
        cached=attempt.cached,
        attempts=attempt.attempts,
        error=(
            f"the narration takes {metrics.duration_seconds}s but the timeline is "
            f"{metrics.timeline_seconds}s. {remedy}"
        ),
    )


def _record(
    attempt: _Attempt,
    run: RunContext,
    prompt_version: str,
    source_sha256: str,
    development: bool,
    transformations: list[str],
) -> VoiceAsset:
    """Build the persisted record for one attempt, successful or not."""
    request = attempt.request
    provenance = GenerationProvenance(
        generator_version=VOICE_VERSION,
        prompt_version=prompt_version,
        system_prompt_sha256=sha256_text(request.instructions or ""),
        user_prompt_sha256=request.narration_sha256,
        provider=request.provider,
        model=request.model,
        generated_at=datetime.now(tz=UTC),
        source_sha256=source_sha256,
        attempts=max(attempt.attempts, 1),
    )
    usable = attempt.passed and attempt.error is None and attempt.path is not None
    status = (
        (AssetStatus.CACHED if attempt.cached else AssetStatus.READY)
        if usable
        else AssetStatus.FAILED
    )
    error = attempt.error
    if not usable and error is None and attempt.report is not None:
        error = failure_summary(attempt.report) or "the narration did not pass validation"

    path = attempt.path if usable else None
    return VoiceAsset(
        id=request.voice_id,
        status=status,
        created_at=datetime.now(tz=UTC),
        provider=request.provider,
        model=request.model,
        voice=request.voice,
        language=request.language,
        audio_format=request.audio_format,
        speed=request.speed,
        instructions=request.instructions,
        instructions_sha256=request.instructions_sha256,
        cache_key=request.cache_key,
        narration_sha256=request.narration_sha256,
        narration_characters=request.characters,
        storyboard_sha256=request.storyboard_sha256,
        target_duration_seconds=request.target_duration_seconds,
        path=path,
        sha256=sha256_file(path) if path else None,
        size_bytes=path.stat().st_size if path else None,
        duration_seconds=attempt.info.duration_seconds if attempt.info and usable else None,
        sample_rate=attempt.info.sample_rate if attempt.info else None,
        channels=attempt.info.channels if attempt.info else None,
        codec=attempt.info.codec if attempt.info else None,
        metrics=attempt.metrics,
        attempts=attempt.attempts,
        cache_hit=attempt.cached,
        development=development,
        transformations=transformations,
        generation_metadata=dict(attempt.metadata),
        validation=attempt.report,
        provenance=provenance,
        error=error,
    )


# --- the stage ---------------------------------------------------------------------


def generate_voice(
    settings: Settings,
    run_id: str | None = None,
    provider: VoiceProvider | None = None,
    offline: bool = False,
    dry_run: bool = False,
    force: bool = False,
    allow_over_budget: bool = False,
    probe: AudioProbe | None = None,
    cache: AssetCache | None = None,
    source_path: Path | None = None,
    on_run_resolved: Callable[[RunContext], None] | None = None,
) -> VoiceResult:
    """Run the narration stage.

    Args:
        settings: effective configuration.
        run_id: run to work in. Defaults to the most recent run.
        provider: voice provider to use. Defaults to the configured one, or
            the offline provider when ``offline`` is set.
        offline: write a placeholder track instead of calling a speech model.
        dry_run: report what would be generated and stop. Nothing is paid for.
        force: regenerate, ignoring the cache and any previous track.
        allow_over_budget: generate even when the estimated cost is not
            covered by ``MAX_GENERATION_COST``. Never implicit.
        probe: audio inspector. Defaults to ffprobe, or WAV header inspection.
        cache: asset cache. Defaults to the one under the output root.
        source_path: overrides ``settings.source_document`` for staleness checks.
        on_run_resolved: called once the run directory is known.

    Raises:
        RunNotFoundError: no run exists.
        StageNotCompletedError: the run has no current, valid plan or storyboard.
        ConfigurationError: real generation was requested without credentials,
            or the provider cannot serve this narration.
        BudgetExceededError: the work is not covered by the configured budget.
    """
    run = resolve_run(settings, run_id)
    if on_run_resolved is not None:
        on_run_resolved(run)

    storyboard, plan, registry = load_upstream(run)
    check_upstream(settings, run, storyboard, plan, registry, source_path)

    voice_cache = cache or AssetCache(settings.asset_cache_root)
    audio_probe = probe or default_audio_probe(settings.ffprobe_bin)
    instructions, prompt_version = voice_direction(settings)

    if provider is not None:
        provider_name, model = provider.name, provider.model
        capabilities = provider.capabilities
        voice_name = (
            settings.voice_name
            if capabilities.supports_voice(settings.voice_name)
            else capabilities.supported_voices[0]
        )
    else:
        provider_name, model, voice_name = voice_provider_identity(settings, offline)
        capabilities = voice_capabilities(settings, offline)

    request = build_request(
        settings=settings,
        storyboard=storyboard,
        plan=plan,
        registry=registry,
        run=run,
        capabilities=capabilities,
        provider_name=provider_name,
        model=model,
        voice_name=voice_name,
        instructions=instructions,
        prompt_version=prompt_version,
    )
    cut = narration_slots(settings, storyboard, request)
    voice_plan = plan_voice(run, request, capabilities, voice_cache, force=force, take_slots=cut)

    logger.info(
        "voice plan",
        extra={
            "run_id": run.run_id,
            **request.describe(),
            "cache_state": voice_plan.cache_state,
            "generation_count": voice_plan.generation_count,
            "takes": len(cut),
            "dry_run": dry_run,
        },
    )
    if dry_run:
        return VoiceResult(run=run, plan=voice_plan, asset=None, dry_run=True)

    if voice_plan.reused and voice_plan.previous is not None:
        logger.info("narration carried over from this run", extra={"voice": request.voice_id})
        return VoiceResult(run=run, plan=voice_plan, asset=voice_plan.previous, dry_run=False)

    # The offline provider costs nothing, so only a real one is budgeted.
    paid = provider_name != FAKE_PROVIDER_NAME
    if paid:
        _check_budget(settings, run, force, allow_over_budget, voice_cache, source_path)

    voice_provider = provider or build_voice_provider(settings, offline)
    shared = {
        "request": request,
        "run": run,
        "provider": voice_provider,
        "capabilities": capabilities,
        "cache": voice_cache,
        "probe": audio_probe,
        "settings": settings,
        "expected_narration_sha256": sha256_text(plan.narration),
        "prompt_version": prompt_version,
        "source_sha256": registry.source_sha256,
        "development": offline or provider_name == FAKE_PROVIDER_NAME,
        "use_cache": not force,
        "log": RequestLog(run.provider_log, run.run_id),
        "paid": paid,
    }
    if cut:
        asset = _generate_takes(
            cut=cut, total_seconds=storyboard.total_duration_seconds, **shared
        )
    else:
        asset = _generate(**shared)
    write_model(run.voice_json, asset)
    _record_stage(run, asset)

    logger.info(
        "voice generation complete",
        extra={
            "run_id": run.run_id,
            "voice": asset.id,
            "status": asset.status.value,
            "duration": asset.duration_seconds,
            "cache_hit": asset.cache_hit,
        },
    )
    return VoiceResult(run=run, plan=voice_plan, asset=asset, dry_run=False)


def narration_slots(
    settings: Settings, storyboard: Storyboard, request: VoiceRequest
) -> list[take_stage.TakeSlot]:
    """Cut the narration the way this configuration asks for.

    Empty when the Reel is spoken as one take, which is what the pipeline has
    always done and still does by default.
    """
    if settings.voice_takes is not VoiceTakes.SCENE:
        return []
    return take_stage.slots(storyboard, request)


def _check_budget(
    settings: Settings,
    run: RunContext,
    force: bool,
    allow_over_budget: bool,
    cache: AssetCache,
    source_path: Path | None,
) -> None:
    """Write down what this narration would spend, and stop if it is too much.

    Raises:
        BudgetExceededError: the work is not covered by the configured budget.
    """
    from maingott_reel.costing import enforce_budget, plan_generation, write_plan

    plan = plan_generation(
        settings,
        run,
        kinds=(GenerationKind.VOICE,),
        offline=False,
        force=force,
        cache=cache,
        source_path=source_path,
    )
    plan = plan.model_copy(update={"dry_run": False})
    write_plan(run, plan)
    logger.info(
        "generation budget",
        extra={
            "run_id": run.run_id,
            "planned_calls": plan.planned_calls,
            "cost": plan.cost.summary(),
        },
    )
    enforce_budget(plan, settings, allow_over_budget=allow_over_budget)


def _record_stage(run: RunContext, asset: VoiceAsset) -> None:
    """Write the voice stage's outcome into the run manifest."""
    manifest = load_or_create_manifest(run)
    manifest.models.voice = asset.model
    manifest.files["voice"] = run.voice_json
    if asset.path is not None:
        manifest.files["voice_audio"] = asset.path
    metrics = asset.metrics
    manifest.record_stage(
        StageName.GENERATE_VOICE,
        completed_at=asset.created_at,
        artifact=run.voice_json,
        notes=(
            f"{asset.status.value}: {asset.provider}:{asset.model} voice '{asset.voice}' "
            f"in {asset.language.value}, narration {asset.narration_sha256[:12]} "
            f"({asset.narration_characters} characters), "
            + (
                f"{metrics.duration_seconds}s at {metrics.characters_per_second} cps / "
                f"{metrics.words_per_minute} wpm, "
                if metrics
                else ""
            )
            + f"{'cache hit' if asset.cache_hit else 'generated'}"
            + (", development output" if asset.development else "")
        ),
    )
    save_manifest(run, manifest)


def voice_track(run: RunContext) -> VoiceAsset | None:
    """Return the run's generated narration, if it has one.

    Used by composition, which treats the voice stage's output as an input.
    """
    asset = _existing_voice(run)
    return asset if asset is not None and asset.is_usable else None


__all__ = [
    "VoicePlan",
    "VoiceResult",
    "narration_slots",
    "build_request",
    "build_voice_provider",
    "generate_voice",
    "load_upstream",
    "plan_voice",
    "voice_capabilities",
    "voice_direction",
    "voice_provider_identity",
    "voice_track",
]
