"""The reproducibility check.

Asks one question of a finished run or a release package: is enough written
down to explain — and in principle rebuild — this Reel later? Which prompts,
which models, which facts, which clips, which narration, which settings.

It regenerates nothing and calls no provider. A missing item is reported, not
filled in.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from maingott_reel.config import Settings
from maingott_reel.models import ReleaseManifest
from maingott_reel.release.inputs import ReleaseInputs
from maingott_reel.utils.hashing import sha256_file

#: Packaged files whose absence does not make a release unauditable.
OPTIONAL_IN_PACKAGE = ("voice", "review", "generation_plan", "provider_requests")


@dataclass(frozen=True)
class ReproducibilityItem:
    """One input the pipeline would need again."""

    name: str
    available: bool
    detail: str
    required: bool = True


@dataclass(frozen=True)
class ReproducibilityReport:
    """What is and is not recoverable about one Reel."""

    subject: str
    items: list[ReproducibilityItem] = field(default_factory=list)

    @property
    def missing(self) -> list[ReproducibilityItem]:
        """Required inputs that are not available."""
        return [item for item in self.items if item.required and not item.available]

    @property
    def reproducible(self) -> bool:
        """Whether every required input is still recorded."""
        return not self.missing

    def summary(self) -> str:
        """One line describing the outcome."""
        available = sum(1 for item in self.items if item.available)
        return f"{available}/{len(self.items)} inputs available for {self.subject}"


def _item(name: str, available: bool, detail: str, required: bool = True) -> ReproducibilityItem:
    return ReproducibilityItem(name=name, available=available, detail=detail, required=required)


def check_run(settings: Settings, inputs: ReleaseInputs) -> ReproducibilityReport:
    """Report whether a finished run records everything needed to explain it."""
    run = inputs.run
    source = settings.source_document
    source_matches = source.is_file() and sha256_file(source) == inputs.registry.source_sha256

    assets_present = [
        asset.id
        for asset in inputs.assets.assets
        if asset.path is None or not Path(asset.path).is_file()
    ]
    prompts = inputs.storyboard.provenance.prompt_version
    voice = inputs.voice
    configuration = run.configuration_json

    items = [
        _item(
            "source specification",
            source_matches,
            f"{source} matches the analysed hash"
            if source_matches
            else f"{source} is missing or has changed since the analysis",
        ),
        _item("facts", run.facts_json.is_file(), str(run.facts_json)),
        _item("creative brief", run.creative_brief_json.is_file(), str(run.creative_brief_json)),
        _item("plan", run.script_json.is_file(), str(run.script_json)),
        _item("storyboard", run.storyboard_json.is_file(), str(run.storyboard_json)),
        _item(
            "shot prompts",
            all(scene.video_prompt for scene in inputs.storyboard.scenes),
            f"{len(inputs.storyboard.scenes)} scene prompts recorded",
        ),
        _item(
            "prompt versions",
            bool(prompts) and prompts != "missing",
            f"plan {inputs.plan.provenance.prompt_version}, storyboard {prompts}",
        ),
        _item(
            "text provider metadata",
            bool(inputs.plan.provenance.model),
            f"{inputs.plan.provenance.provider}:{inputs.plan.provenance.model}",
        ),
        _item("assets record", run.assets_json.is_file(), str(run.assets_json)),
        _item(
            "asset files",
            not assets_present,
            f"missing: {', '.join(assets_present)}"
            if assets_present
            else f"{len(inputs.assets.assets)} clips present",
        ),
        _item(
            "video provider metadata",
            bool(inputs.assets.model),
            f"{inputs.assets.provider}:{inputs.assets.model}",
        ),
        _item(
            "voice record",
            voice is not None,
            str(run.voice_json)
            if voice is not None
            else "no voice.json: the narration cannot be traced",
        ),
        _item(
            "voice audio",
            voice is not None and voice.path is not None and Path(voice.path).is_file(),
            str(voice.path) if voice is not None and voice.path else "no narration file",
        ),
        _item("composition", run.composition_json.is_file(), str(run.composition_json)),
        _item(
            "configuration snapshot",
            configuration.is_file(),
            str(configuration)
            if configuration.is_file()
            else "run 'release-check' to record the configuration",
        ),
        _item("manifest", run.manifest_json.is_file(), str(run.manifest_json)),
        _item(
            "provider request log",
            run.provider_log.is_file(),
            str(run.provider_log) if run.provider_log.is_file() else "no requests were recorded",
            required=False,
        ),
        _item(
            "finished Reel",
            inputs.final_path.is_file(),
            str(inputs.final_path),
        ),
    ]
    return ReproducibilityReport(subject=f"run {run.run_id}", items=items)


def check_package(root: Path, manifest: ReleaseManifest) -> ReproducibilityReport:
    """Report whether a release package can be audited on its own."""
    items: list[ReproducibilityItem] = []
    for entry in manifest.files:
        path = root / entry.path
        present = path.is_file() and sha256_file(path) == entry.sha256
        items.append(
            _item(
                entry.name,
                present,
                str(path) if present else f"{entry.path} is missing or has changed",
                required=entry.name
                not in ("voice", "review", "generation_plan", "provider_requests"),
            )
        )
    items.append(
        _item(
            "configuration snapshot",
            bool(manifest.configuration.prompt_versions),
            f"pipeline {manifest.configuration.pipeline_version}, "
            f"{len(manifest.configuration.prompt_versions)} prompt versions",
        )
    )
    items.append(
        _item(
            "provider metadata",
            bool(manifest.video_model and manifest.voice_model),
            f"video {manifest.video_provider}:{manifest.video_model}, "
            f"voice {manifest.voice_provider}:{manifest.voice_model}",
        )
    )
    return ReproducibilityReport(subject=f"release {manifest.release_id}", items=items)
