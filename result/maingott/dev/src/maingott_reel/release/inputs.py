"""Loading everything a release decision depends on.

The release commands all ask the same question of a run — what exactly is
here, and what is its fingerprint — so they load it the same way, from the
artifacts on disk rather than from anything remembered.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import orjson
from pydantic import ValidationError

from maingott_reel.config import Settings
from maingott_reel.errors import StageNotCompletedError
from maingott_reel.models import (
    ArtifactFingerprint,
    AssetCollection,
    Composition,
    CreativeBrief,
    FactRegistry,
    QualityReport,
    RunManifest,
    ScriptPlan,
    Storyboard,
    VoiceAsset,
)
from maingott_reel.release.configuration import configuration_sha256
from maingott_reel.utils.hashing import sha256_file
from maingott_reel.utils.jsonio import read_model
from maingott_reel.utils.manifest_store import load_manifest
from maingott_reel.utils.run_context import RunContext
from maingott_reel.video.timeline import assets_identity


@dataclass(frozen=True)
class ReleaseInputs:
    """Every artifact a release decision is made from."""

    run: RunContext
    manifest: RunManifest
    registry: FactRegistry
    brief: CreativeBrief
    plan: ScriptPlan
    storyboard: Storyboard
    assets: AssetCollection
    composition: Composition
    voice: VoiceAsset | None
    quality: QualityReport | None

    @property
    def final_path(self) -> Path:
        """The finished Reel this run produced."""
        return self.composition.output_path or self.run.final_video


def load_inputs(run: RunContext) -> ReleaseInputs:
    """Load a finished run.

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

    manifest = load_manifest(run)
    if manifest is None:
        raise StageNotCompletedError(
            f"Run {run.run_id} has no manifest. Re-run the pipeline for this run."
        )
    try:
        voice = read_model(run.voice_json, VoiceAsset) if run.voice_json.is_file() else None
        quality = (
            read_model(run.validation_json, QualityReport)
            if run.validation_json.is_file()
            else None
        )
        return ReleaseInputs(
            run=run,
            manifest=manifest,
            registry=read_model(run.facts_json, FactRegistry),
            brief=read_model(run.creative_brief_json, CreativeBrief),
            plan=read_model(run.script_json, ScriptPlan),
            storyboard=read_model(run.storyboard_json, Storyboard),
            assets=read_model(run.assets_json, AssetCollection),
            composition=read_model(run.composition_json, Composition),
            voice=voice,
            quality=quality,
        )
    except (ValidationError, orjson.JSONDecodeError, OSError) as error:
        raise StageNotCompletedError(
            f"Run {run.run_id} has unreadable artifacts ({error})."
        ) from error


def fingerprint(settings: Settings, inputs: ReleaseInputs) -> ArtifactFingerprint:
    """Hash the whole chain that produced this exact Reel.

    The finished file is hashed from disk rather than read out of
    ``composition.json``: an approval must describe the bytes that are
    actually there.

    Raises:
        StageNotCompletedError: the finished Reel is missing.
    """
    final = inputs.final_path
    if not final.is_file():
        raise StageNotCompletedError(
            f"Run {inputs.run.run_id} has no finished Reel at {final}. Run 'compose' first."
        )
    return ArtifactFingerprint(
        source_sha256=inputs.registry.source_sha256,
        plan_sha256=sha256_file(inputs.run.script_json),
        storyboard_sha256=sha256_file(inputs.run.storyboard_json),
        assets_sha256=assets_identity(inputs.assets),
        voice_sha256=inputs.composition.audio.voice_sha256,
        narration_sha256=inputs.composition.narration_sha256,
        composition_sha256=inputs.composition.composition_sha256,
        final_sha256=sha256_file(final),
        configuration_sha256=configuration_sha256(settings),
    )
