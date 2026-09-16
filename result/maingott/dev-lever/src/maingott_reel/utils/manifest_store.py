"""Reading and writing the per-run manifest.

Every stage records what it produced here, so a run can be inspected, resumed
or compared later without re-reading the artifacts themselves.
"""

from __future__ import annotations

from datetime import UTC, datetime

from maingott_reel import __version__
from maingott_reel.models import RunManifest
from maingott_reel.utils.jsonio import read_model, write_model
from maingott_reel.utils.run_context import RunContext


def load_manifest(run: RunContext) -> RunManifest | None:
    """Return the manifest of ``run`` if it has one."""
    if not run.manifest_json.is_file():
        return None
    return read_model(run.manifest_json, RunManifest)


def load_or_create_manifest(run: RunContext, created_at: datetime | None = None) -> RunManifest:
    """Return the manifest of ``run``, creating an empty one if needed."""
    existing = load_manifest(run)
    if existing is not None:
        return existing
    return RunManifest(
        run_id=run.run_id,
        created_at=created_at or datetime.now(tz=UTC),
        app_version=__version__,
    )


def save_manifest(run: RunContext, manifest: RunManifest) -> RunManifest:
    """Persist ``manifest`` into the run directory."""
    write_model(run.manifest_json, manifest)
    return manifest
