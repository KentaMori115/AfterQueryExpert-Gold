"""Auditioning candidate narration voices.

Nobody has approved a MainGott voice, and nothing in this project may choose
one. What it *can* do is put the same short piece of approved narration in
front of several candidate voices so a person can listen and decide.

An audition is deliberately separate from a run: it writes to its own
directory, touches no artifact, and approves nothing. The decision is recorded
by hand in ``input/brand/voice_profile.json``.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from maingott_reel.audio.probe import AudioProbe, default_audio_probe
from maingott_reel.audio.voice import (
    FAKE_PROVIDER_NAME,
    build_voice_provider,
    load_upstream,
    voice_capabilities,
    voice_direction,
    voice_provider_identity,
)
from maingott_reel.config import Settings
from maingott_reel.errors import ConfigurationError, ProviderError, TransientProviderError
from maingott_reel.logging_config import get_logger
from maingott_reel.models import (
    AuditionSample,
    CostReport,
    GenerationKind,
    GenerationPlan,
    PlannedGeneration,
    RequestOutcome,
    ScriptPlan,
    VoiceAudition,
)
from maingott_reel.providers.base import VoiceCapabilities, VoiceProvider
from maingott_reel.release.configuration import configuration_sha256
from maingott_reel.utils.hashing import sha256_file, sha256_text
from maingott_reel.utils.jsonio import write_model
from maingott_reel.utils.request_log import RequestLog
from maingott_reel.utils.run_context import RunContext, resolve_run

logger = get_logger("audio.audition")

#: How much approved narration a candidate reads. Long enough to judge a voice,
#: short enough that auditioning a dozen of them costs almost nothing.
SAMPLE_MAX_CHARACTERS = 240


@dataclass(frozen=True)
class AuditionResult:
    """What the audition stage produced."""

    run: RunContext
    audition: VoiceAudition
    directory: Path
    plan: GenerationPlan
    dry_run: bool

    @property
    def complete(self) -> bool:
        """Whether every candidate produced audio."""
        return bool(self.audition.samples) and not self.audition.failed


def sample_text(plan: ScriptPlan, limit: int = SAMPLE_MAX_CHARACTERS) -> str:
    """Return a verbatim extract of the approved narration.

    Whole lines only, never re-worded and never cut mid-sentence: a candidate
    voice is judged on the words the plan actually approved.

    Raises:
        ConfigurationError: the plan holds no narration.
    """
    lines = [line for line in plan.narration.splitlines() if line.strip()]
    if not lines:
        raise ConfigurationError("The approved plan holds no narration to audition.")

    chosen: list[str] = []
    length = 0
    for line in lines:
        if chosen and length + len(line) + 1 > limit:
            break
        chosen.append(line)
        length += len(line) + 1
    return "\n".join(chosen)


def candidate_voices(
    settings: Settings, capabilities: VoiceCapabilities, requested: list[str] | None
) -> list[str]:
    """Resolve which voices to audition.

    Defaults to everything the provider offers — narrowing the field is a
    human's call, not this function's.

    Raises:
        ConfigurationError: a requested voice does not exist.
    """
    if not requested:
        return list(capabilities.supported_voices)
    unknown = [voice for voice in requested if not capabilities.supports_voice(voice)]
    if unknown:
        raise ConfigurationError(
            f"{settings.voice_provider} does not offer: {', '.join(unknown)}. "
            f"Available: {', '.join(capabilities.supported_voices)}."
        )
    return list(requested)


def audition_directory(settings: Settings, sample_sha256: str) -> Path:
    """Where one audition's samples live, keyed by the words being read."""
    return settings.output_root / "auditions" / sample_sha256[:12]


def _plan(
    settings: Settings,
    run: RunContext,
    voices: list[str],
    provider_name: str,
    model: str,
    characters: int,
    offline: bool,
) -> GenerationPlan:
    """Describe what auditioning would cost, before it costs anything."""
    from maingott_reel.costing import _price_line, load_pricing

    pricing = load_pricing(settings)
    items = [
        PlannedGeneration(
            kind=GenerationKind.VOICE,
            identity=f"audition-{voice}",
            provider=provider_name,
            model=model,
            characters=characters,
        )
        for voice in voices
    ]
    line = _price_line(
        kind=GenerationKind.VOICE,
        provider=provider_name,
        model=model,
        calls=len(voices),
        units=float(characters * len(voices)),
        unit="characters",
        pricing=pricing,
        detail=f"{len(voices)} candidate voice(s) reading {characters} characters each",
    )
    return GenerationPlan(
        run_id=run.run_id,
        created_at=datetime.now(tz=UTC),
        dry_run=True,
        offline=offline,
        configuration_sha256=configuration_sha256(settings),
        items=items,
        cost=CostReport(
            currency=pricing.currency if pricing else "USD",
            lines=[line],
            budget_usd=settings.max_generation_cost,
            pricing_source=pricing.source if pricing else None,
            pricing_path=settings.pricing_path if pricing else None,
        ),
    )


def audition(
    settings: Settings,
    run_id: str | None = None,
    voices: list[str] | None = None,
    offline: bool = False,
    dry_run: bool = False,
    allow_over_budget: bool = False,
    provider: VoiceProvider | None = None,
    probe: AudioProbe | None = None,
    on_run_resolved: Callable[[RunContext], None] | None = None,
) -> AuditionResult:
    """Record candidate voices reading the same approved narration.

    Changes nothing about the run and approves nothing. The samples exist so a
    person can listen; the decision belongs in ``voice_profile.json``.

    Args:
        settings: effective configuration.
        run_id: run whose approved narration supplies the sample.
        voices: candidates to audition. Defaults to every voice the provider offers.
        offline: use the placeholder provider instead of a speech model.
        dry_run: report what would be generated and stop.
        allow_over_budget: audition even when the cost is not covered.
        provider: voice provider to use. Defaults to the configured one.
        probe: audio inspector. Defaults to ffprobe, or WAV header inspection.
        on_run_resolved: called once the run directory is known.

    Raises:
        RunNotFoundError: no run exists.
        StageNotCompletedError: the run has no approved plan.
        ConfigurationError: the provider cannot serve this audition.
        BudgetExceededError: the work is not covered by the configured budget.
    """
    from maingott_reel.costing import enforce_budget

    run = resolve_run(settings, run_id)
    if on_run_resolved is not None:
        on_run_resolved(run)

    _, plan, _ = load_upstream(run)
    text = sample_text(plan)
    sample_hash = sha256_text(text)

    if provider is not None:
        provider_name, model = provider.name, provider.model
        capabilities = provider.capabilities
    else:
        provider_name, model, _ = voice_provider_identity(settings, offline)
        capabilities = voice_capabilities(settings, offline)

    chosen = candidate_voices(settings, capabilities, voices)
    if plan.language not in capabilities.supported_languages:
        raise ConfigurationError(
            f"{provider_name}:{model} is not configured to narrate in '{plan.language.value}'."
        )

    instructions, _ = voice_direction(settings)
    generation_plan = _plan(settings, run, chosen, provider_name, model, len(text), offline)
    directory = audition_directory(settings, sample_hash)

    logger.info(
        "voice audition planned",
        extra={
            "run_id": run.run_id,
            "provider": provider_name,
            "model": model,
            "voices": len(chosen),
            "characters": len(text),
            "cost": generation_plan.cost.summary(),
            "dry_run": dry_run,
        },
    )
    if dry_run:
        return AuditionResult(
            run=run,
            audition=VoiceAudition(
                created_at=datetime.now(tz=UTC),
                run_id=run.run_id,
                sample_text=text,
                sample_sha256=sample_hash,
                narration_sha256=sha256_text(plan.narration),
            ),
            directory=directory,
            plan=generation_plan,
            dry_run=True,
        )

    paid = provider_name != FAKE_PROVIDER_NAME
    if paid:
        enforce_budget(generation_plan, settings, allow_over_budget=allow_over_budget)

    speaker = provider or build_voice_provider(settings, offline)
    audio_probe = probe or default_audio_probe(settings.ffprobe_bin)
    log = RequestLog(run.provider_log, run.run_id)
    directory.mkdir(parents=True, exist_ok=True)

    samples = [
        _record(
            voice=voice,
            text=text,
            settings=settings,
            provider=speaker,
            provider_name=provider_name,
            model=model,
            language=plan.language,
            instructions=instructions if capabilities.supports_instructions else None,
            directory=directory,
            probe=audio_probe,
            log=log,
            paid=paid,
        )
        for voice in chosen
    ]

    recorded = VoiceAudition(
        created_at=datetime.now(tz=UTC),
        run_id=run.run_id,
        sample_text=text,
        sample_sha256=sample_hash,
        narration_sha256=sha256_text(plan.narration),
        samples=samples,
    )
    write_model(directory / "audition.json", recorded)
    logger.info(
        "voice audition complete",
        extra={
            "run_id": run.run_id,
            "directory": str(directory),
            "usable": len(recorded.usable),
            "failed": len(recorded.failed),
        },
    )
    return AuditionResult(
        run=run, audition=recorded, directory=directory, plan=generation_plan, dry_run=False
    )


def _record(
    voice: str,
    text: str,
    settings: Settings,
    provider: VoiceProvider,
    provider_name: str,
    model: str,
    language: object,
    instructions: str | None,
    directory: Path,
    probe: AudioProbe,
    log: RequestLog,
    paid: bool,
) -> AuditionSample:
    """Have one candidate read the sample, and measure what came back."""
    from maingott_reel.models import Language

    assert isinstance(language, Language)  # narrowed by the caller
    destination = directory / f"{voice}{settings.voice_format.suffix}"
    moment = datetime.now(tz=UTC)
    common = {
        "voice": voice,
        "provider": provider_name,
        "model": model,
        "language": language,
        "audio_format": settings.voice_format,
        "speed": settings.voice_speed,
        "instructions_sha256": sha256_text(instructions) if instructions else None,
        "created_at": moment,
        "development": provider_name == FAKE_PROVIDER_NAME,
    }

    try:
        provider.synthesize(
            text=text,
            voice=voice,
            language=language,
            audio_format=settings.voice_format,
            destination=destination,
            instructions=instructions,
            speed=settings.voice_speed,
        )
    except (ProviderError, TransientProviderError, ConfigurationError) as error:
        log.record(
            provider=provider_name,
            model=model,
            operation="audio.speech.audition",
            outcome=RequestOutcome.REJECTED,
            paid=paid,
            voice=voice,
            language=language.value,
            characters=len(text),
            detail=str(error),
        )
        logger.warning("audition failed", extra={"voice": voice, "error": str(error)})
        return AuditionSample(**common, error=str(error))

    log.record(
        provider=provider_name,
        model=model,
        operation="audio.speech.audition",
        outcome=RequestOutcome.SUCCESS,
        paid=paid,
        voice=voice,
        language=language.value,
        characters=len(text),
    )
    try:
        info = probe.inspect_audio(destination)
    except Exception as error:  # noqa: BLE001 - an unreadable sample is a failed one
        return AuditionSample(**common, error=f"the sample is unreadable: {error}")

    return AuditionSample(
        **common,
        path=destination,
        sha256=sha256_file(destination),
        size_bytes=destination.stat().st_size,
        duration_seconds=info.duration_seconds,
        sample_rate=info.sample_rate,
        channels=info.channels,
        codec=info.codec,
    )
