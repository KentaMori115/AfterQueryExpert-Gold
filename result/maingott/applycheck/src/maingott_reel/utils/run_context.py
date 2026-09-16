"""Deterministic run directories.

Every run owns one directory under ``output/runs/<run_id>/`` with a fixed
layout, so any stage can be re-run or resumed without guessing paths. The
layout mirrors ``docs/architecture/ARCHITECTURE.md``.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from maingott_reel.config import Settings
from maingott_reel.errors import RunNotFoundError, StageNotCompletedError

#: File in ``output/runs/`` holding the id of the most recent run.
LATEST_POINTER = "LATEST"

_RUN_ID_FORMAT = "%Y%m%d-%H%M%S"


@dataclass(frozen=True)
class RunContext:
    """Filesystem layout of a single run."""

    run_id: str
    root: Path

    # --- Stage artifacts -------------------------------------------------
    @property
    def source_json(self) -> Path:
        return self.root / "source.json"

    @property
    def facts_json(self) -> Path:
        return self.root / "facts.json"

    @property
    def creative_brief_json(self) -> Path:
        return self.root / "creative_brief.json"

    @property
    def script_json(self) -> Path:
        return self.root / "script.json"

    @property
    def storyboard_json(self) -> Path:
        return self.root / "storyboard.json"

    @property
    def assets_json(self) -> Path:
        return self.root / "assets.json"

    @property
    def voice_json(self) -> Path:
        return self.root / "voice.json"

    @property
    def composition_json(self) -> Path:
        return self.root / "composition.json"

    @property
    def validation_json(self) -> Path:
        return self.root / "validation.json"

    @property
    def manifest_json(self) -> Path:
        return self.root / "manifest.json"

    @property
    def configuration_json(self) -> Path:
        """Sanitized snapshot of the configuration that produced this run."""
        return self.root / "configuration.json"

    @property
    def generation_plan_json(self) -> Path:
        """What a paid run would do, written down before it does it."""
        return self.root / "generation_plan.json"

    @property
    def review_json(self) -> Path:
        """The human review checklist for this run's Reel."""
        return self.root / "review.json"

    @property
    def approval_json(self) -> Path:
        """The human approval decision for this run's Reel."""
        return self.root / "approval.json"

    # --- Directories ------------------------------------------------------
    @property
    def assets_dir(self) -> Path:
        return self.root / "assets"

    @property
    def audio_dir(self) -> Path:
        """Directory holding the run's generated narration."""
        return self.root / "audio"

    @property
    def final_dir(self) -> Path:
        return self.root / "final"

    @property
    def composition_dir(self) -> Path:
        """Working directory for post-production intermediates."""
        return self.root / "composition"

    @property
    def logs_dir(self) -> Path:
        return self.root / "logs"

    @property
    def final_video(self) -> Path:
        return self.final_dir / "maingott_reel.mp4"

    def voice_audio(self, suffix: str = ".wav") -> Path:
        """Where the generated narration lives inside the run."""
        return self.audio_dir / f"voice{suffix}"

    @property
    def takes_dir(self) -> Path:
        """Directory holding the individual takes of a scene-by-scene track."""
        return self.audio_dir / "takes"

    def take_audio(self, scene_id: str, suffix: str = ".wav") -> Path:
        """Where one scene's take lives before it is laid onto the timeline."""
        return self.takes_dir / f"{scene_id}{suffix}"

    @property
    def log_file(self) -> Path:
        return self.logs_dir / "run.jsonl"

    @property
    def provider_log(self) -> Path:
        """Append-only record of every provider request this run made."""
        return self.logs_dir / "provider_requests.jsonl"

    def create_directories(self) -> None:
        """Create the run layout. Safe to call repeatedly."""
        for directory in (
            self.root,
            self.assets_dir,
            self.audio_dir,
            self.composition_dir,
            self.final_dir,
            self.logs_dir,
        ):
            directory.mkdir(parents=True, exist_ok=True)

    def require(self, artifact: Path, stage: str) -> Path:
        """Return ``artifact`` or explain which stage must run first."""
        if not artifact.exists():
            raise StageNotCompletedError(
                f"{artifact.name} is missing in run {self.run_id}; run '{stage}' first."
            )
        return artifact


def new_run_id(now: datetime | None = None) -> str:
    """Return a sortable run id derived from the current UTC time."""
    moment = now or datetime.now(tz=UTC)
    return moment.strftime(_RUN_ID_FORMAT)


def create_run(settings: Settings, run_id: str | None = None) -> RunContext:
    """Create (or reuse) a run directory and mark it as the latest run."""
    resolved_id = run_id or new_run_id()
    context = RunContext(run_id=resolved_id, root=settings.runs_root / resolved_id)
    context.create_directories()
    write_latest(settings, resolved_id)
    return context


def resolve_run(settings: Settings, run_id: str | None = None) -> RunContext:
    """Return an existing run, defaulting to the most recent one."""
    resolved_id = run_id or read_latest(settings)
    if resolved_id is None:
        raise RunNotFoundError("No run found. Run 'analyze' first, or pass --run-id explicitly.")
    root = settings.runs_root / resolved_id
    if not root.is_dir():
        raise RunNotFoundError(f"Run '{resolved_id}' does not exist at {root}.")
    return RunContext(run_id=resolved_id, root=root)


def write_latest(settings: Settings, run_id: str) -> None:
    """Record ``run_id`` as the most recent run."""
    settings.runs_root.mkdir(parents=True, exist_ok=True)
    (settings.runs_root / LATEST_POINTER).write_text(run_id + "\n", encoding="utf-8")


def read_latest(settings: Settings) -> str | None:
    """Return the most recent run id, if any."""
    pointer = settings.runs_root / LATEST_POINTER
    if not pointer.is_file():
        return None
    value = pointer.read_text(encoding="utf-8").strip()
    return value or None
