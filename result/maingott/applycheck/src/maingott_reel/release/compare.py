"""Comparing two runs.

Deterministic, artifact-level differences only: what changed between two
generations of this Reel, taken from the JSON they wrote down. No model is
consulted and no frame is looked at — whether the new version is *better* is
not a question this can answer.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from maingott_reel.config import Settings
from maingott_reel.models import Composition, ScriptPlan, Storyboard
from maingott_reel.release.inputs import ReleaseInputs
from maingott_reel.utils.hashing import sha256_file, sha256_text
from maingott_reel.utils.run_context import RunContext, resolve_run
from maingott_reel.video.timeline import assets_identity


@dataclass(frozen=True)
class Difference:
    """One aspect of two runs, side by side."""

    aspect: str
    left: str
    right: str

    @property
    def changed(self) -> bool:
        """Whether the two runs disagree here."""
        return self.left != self.right


@dataclass(frozen=True)
class ComparisonReport:
    """Everything two runs disagree about."""

    left_run_id: str
    right_run_id: str
    differences: list[Difference] = field(default_factory=list)

    @property
    def changed(self) -> list[Difference]:
        """Only the aspects that differ."""
        return [item for item in self.differences if item.changed]

    @property
    def identical(self) -> bool:
        """Whether the two runs produced the same Reel."""
        return not self.changed

    def summary(self) -> str:
        """One line describing the comparison."""
        if self.identical:
            return f"{self.left_run_id} and {self.right_run_id} are identical"
        return (
            f"{len(self.changed)} of {len(self.differences)} aspects differ between "
            f"{self.left_run_id} and {self.right_run_id}"
        )


def _plan_row(plan: ScriptPlan) -> list[tuple[str, str]]:
    return [
        ("narration", sha256_text(plan.narration)[:16]),
        ("narration characters", str(len(plan.narration))),
        ("beats", str(plan.beat_count)),
        ("facts cited", str(len(plan.source_fact_ids))),
        ("plan model", f"{plan.provenance.provider}:{plan.provenance.model}"),
    ]


def _storyboard_row(board: Storyboard) -> list[tuple[str, str]]:
    durations = ", ".join(f"{scene.duration_seconds:g}" for scene in board.scenes)
    return [
        ("scenes", str(board.scene_count)),
        ("storyboard duration", f"{board.total_duration_seconds:g}s"),
        ("scene durations", durations),
        ("transitions", ", ".join(scene.transition.value for scene in board.scenes)),
    ]


def _composition_row(composition: Composition) -> list[tuple[str, str]]:
    audio = composition.audio
    return [
        ("composition", composition.composition_sha256[:16]),
        ("final duration", f"{composition.timeline_duration_seconds:g}s"),
        ("resolution", f"{composition.settings.width}x{composition.settings.height}"),
        ("frame rate", f"{composition.settings.fps} fps"),
        ("captions", str(len(composition.captions))),
        ("logo", str(composition.logo.path) if composition.logo else "— none —"),
        ("music", str(audio.music_path) if audio.has_music else "— none —"),
        ("development", "yes" if composition.development else "no"),
    ]


def _voice_row(inputs: ReleaseInputs) -> list[tuple[str, str]]:
    voice = inputs.voice
    audio = inputs.composition.audio
    if voice is None:
        return [
            ("voice", str(audio.voice_path) if audio.voice_path else "— silent —"),
            ("voice audio", (audio.voice_sha256 or "—")[:16]),
        ]
    rows = [
        ("voice", f"{voice.provider}:{voice.model} '{voice.voice}' ({voice.language.value})"),
        ("voice audio", (voice.sha256 or "—")[:16]),
        ("voice duration", f"{voice.duration_seconds:g}s" if voice.duration_seconds else "—"),
        ("voice speed", f"{voice.speed:g}" if voice.speed else "default"),
    ]
    # Two Reels that speak the same words can still have been recorded very
    # differently, and which scenes were spoken separately is the difference a
    # listener would notice first.
    rows.append(
        (
            "narration takes",
            f"{len(voice.takes)} scene takes, {voice.spoken_seconds:g}s spoken"
            if voice.takes
            else "one take for the whole Reel",
        )
    )
    return rows


def _rows(inputs: ReleaseInputs) -> list[tuple[str, str]]:
    """Every comparable aspect of one run."""
    final = inputs.final_path
    return [
        ("source specification", inputs.registry.source_sha256[:16]),
        *_plan_row(inputs.plan),
        *_storyboard_row(inputs.storyboard),
        ("assets", assets_identity(inputs.assets)[:16]),
        ("asset provider", f"{inputs.assets.provider}:{inputs.assets.model}"),
        ("assets ready", f"{len(inputs.assets.ready)}/{len(inputs.assets.assets)}"),
        *_voice_row(inputs),
        *_composition_row(inputs.composition),
        ("final file", sha256_file(final)[:16] if final.is_file() else "— missing —"),
        (
            "final size",
            f"{final.stat().st_size} bytes" if final.is_file() else "— missing —",
        ),
    ]


def compare_runs(settings: Settings, left_id: str, right_id: str) -> ComparisonReport:
    """Compare the production artifacts of two runs.

    Raises:
        RunNotFoundError: either run does not exist.
        StageNotCompletedError: either run is not finished.
    """
    from maingott_reel.release.inputs import load_inputs

    left = _load(settings, left_id)
    right = _load(settings, right_id)
    left_rows = _rows(load_inputs(left))
    right_rows = _rows(load_inputs(right))

    right_by_aspect = dict(right_rows)
    differences = [
        Difference(aspect=aspect, left=value, right=right_by_aspect.get(aspect, "— absent —"))
        for aspect, value in left_rows
    ]
    return ComparisonReport(
        left_run_id=left.run_id, right_run_id=right.run_id, differences=differences
    )


def _load(settings: Settings, run_id: str) -> RunContext:
    """Resolve one run by id."""
    return resolve_run(settings, run_id)
