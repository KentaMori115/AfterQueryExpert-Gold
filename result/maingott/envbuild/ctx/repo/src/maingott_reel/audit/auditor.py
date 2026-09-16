"""The ``validate`` stage.

An independent audit of a finished run. It loads every artifact, re-derives
the answers rather than trusting what each stage recorded, and writes the
verdict to ``validation.json``.

Nothing here fixes anything: a run either satisfies the quality gates or it is
reported as failing them.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import orjson
from pydantic import ValidationError

from maingott_reel.assets.probe import MediaProbe, default_probe
from maingott_reel.audio.probe import AudioProbe, default_audio_probe
from maingott_reel.audit.gates import (
    asset_gates,
    claim_gates,
    file_gates,
    placeholder_gate,
    presentation_gates,
    readiness_gates,
    run_gates,
    voice_gates,
)
from maingott_reel.config import Settings
from maingott_reel.errors import StageNotCompletedError
from maingott_reel.logging_config import get_logger
from maingott_reel.models import (
    AssetCollection,
    Composition,
    CreativeBrief,
    FactRegistry,
    QualityGate,
    QualityReport,
    RunManifest,
    ScriptPlan,
    StageName,
    Storyboard,
    VoiceAsset,
)
from maingott_reel.utils.jsonio import read_model, write_model
from maingott_reel.utils.manifest_store import load_manifest, load_or_create_manifest, save_manifest
from maingott_reel.utils.run_context import RunContext, resolve_run

logger = get_logger("audit")


@dataclass(frozen=True)
class AuditResult:
    """What the ``validate`` stage found."""

    run: RunContext
    report: QualityReport
    strict: bool

    @property
    def passed(self) -> bool:
        """Whether the run satisfies the gates it is held to."""
        return self.report.production_ready if self.strict else self.report.passed

    @property
    def production_ready(self) -> bool:
        """Whether the Reel could be published as it stands."""
        return self.report.production_ready

    @property
    def failures(self) -> list[QualityGate]:
        """Every gate that did not pass."""
        return self.report.failures


@dataclass(frozen=True)
class _Artifacts:
    """Everything the audit reads."""

    manifest: RunManifest
    registry: FactRegistry
    brief: CreativeBrief
    plan: ScriptPlan
    storyboard: Storyboard
    assets: AssetCollection
    composition: Composition
    voice: VoiceAsset | None


def _load(run: RunContext) -> _Artifacts:
    """Load every artifact a finished run should have.

    Raises:
        StageNotCompletedError: the run is not finished, or an artifact is
            unreadable.
    """
    for artifact, stage in (
        (run.facts_json, "analyze"),
        (run.creative_brief_json, "plan"),
        (run.script_json, "plan"),
        (run.storyboard_json, "storyboard"),
        (run.assets_json, "generate-assets"),
        (run.composition_json, "compose"),
    ):
        run.require(artifact, stage)

    voice: VoiceAsset | None = None
    if run.voice_json.is_file():
        try:
            voice = read_model(run.voice_json, VoiceAsset)
        except (ValidationError, orjson.JSONDecodeError, OSError) as error:
            raise StageNotCompletedError(
                f"Run {run.run_id} has an unreadable voice.json ({error})."
            ) from error

    manifest = load_manifest(run)
    if manifest is None:
        raise StageNotCompletedError(
            f"Run {run.run_id} has no manifest. Re-run the pipeline for this run."
        )
    try:
        return _Artifacts(
            manifest=manifest,
            registry=read_model(run.facts_json, FactRegistry),
            brief=read_model(run.creative_brief_json, CreativeBrief),
            plan=read_model(run.script_json, ScriptPlan),
            storyboard=read_model(run.storyboard_json, Storyboard),
            assets=read_model(run.assets_json, AssetCollection),
            composition=read_model(run.composition_json, Composition),
            voice=voice,
        )
    except (ValidationError, orjson.JSONDecodeError, OSError) as error:
        raise StageNotCompletedError(
            f"Run {run.run_id} has unreadable artifacts ({error})."
        ) from error


def audit(
    settings: Settings,
    run_id: str | None = None,
    strict: bool = False,
    probe: MediaProbe | None = None,
    audio_probe: AudioProbe | None = None,
    source_path: Path | None = None,
    on_run_resolved: Callable[[RunContext], None] | None = None,
) -> AuditResult:
    """Run every quality gate against a finished run.

    Args:
        settings: effective configuration.
        run_id: run to audit. Defaults to the most recent run.
        strict: treat advisory warnings as failures too, so a development
            Reel cannot be reported as acceptable.
        probe: media inspector. Defaults to ffprobe.
        audio_probe: narration inspector. Defaults to ffprobe.
        source_path: overrides ``settings.source_document`` for drift checks.
        on_run_resolved: called once the run directory is known.

    Raises:
        RunNotFoundError: no run exists.
        StageNotCompletedError: the run has not been composed yet.
    """
    run = resolve_run(settings, run_id)
    if on_run_resolved is not None:
        on_run_resolved(run)

    artifacts = _load(run)
    media_probe = probe or default_probe(settings.ffprobe_bin)
    narration_probe = audio_probe or default_audio_probe(settings.ffprobe_bin)
    final = artifacts.composition.output_path or run.final_video

    gates: list[QualityGate] = [
        *run_gates(
            manifest=artifacts.manifest,
            registry=artifacts.registry,
            plan=artifacts.plan,
            storyboard=artifacts.storyboard,
            assets=artifacts.assets,
            composition=artifacts.composition,
            storyboard_path=run.storyboard_json,
            source_path=source_path or settings.source_document,
        ),
        *asset_gates(artifacts.assets, artifacts.storyboard),
        *claim_gates(
            plan=artifacts.plan,
            brief=artifacts.brief,
            storyboard=artifacts.storyboard,
            composition=artifacts.composition,
            registry=artifacts.registry,
            min_duration=settings.min_reel_duration,
            max_duration=settings.max_reel_duration,
        ),
        placeholder_gate(artifacts.brief, artifacts.storyboard, artifacts.composition),
        *file_gates(
            path=final,
            composition=artifacts.composition,
            probe=media_probe,
            min_duration=settings.min_reel_duration,
            max_duration=settings.max_reel_duration,
        ),
        *voice_gates(
            composition=artifacts.composition,
            storyboard=artifacts.storyboard,
            plan=artifacts.plan,
            manifest=artifacts.manifest,
            voice=artifacts.voice,
            probe=narration_probe,
        ),
        *presentation_gates(artifacts.composition),
        *readiness_gates(artifacts.composition),
    ]

    report = QualityReport(created_at=datetime.now(tz=UTC), run_id=run.run_id, gates=gates)
    write_model(run.validation_json, report)
    _record_stage(run, report)

    logger.info(
        "validation complete",
        extra={
            "run_id": run.run_id,
            "passed": report.passed,
            "production_ready": report.production_ready,
            "blocking": len(report.blocking_failures),
            "warnings": len(report.warnings),
        },
    )
    return AuditResult(run=run, report=report, strict=strict)


def _record_stage(run: RunContext, report: QualityReport) -> None:
    """Write the audit's outcome into the run manifest."""
    manifest = load_or_create_manifest(run)
    manifest.quality = report
    manifest.files["validation"] = run.validation_json
    manifest.record_stage(
        StageName.VALIDATE,
        completed_at=report.created_at,
        artifact=run.validation_json,
        notes=report.summary(),
    )
    save_manifest(run, manifest)
