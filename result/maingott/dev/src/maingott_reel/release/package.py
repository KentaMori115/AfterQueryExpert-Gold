"""Building and validating an immutable release package.

A release is a directory that can be audited years later by someone with no
access to this machine: the finished Reel, the decision that approved it, and
every artifact that explains how it came to exist — each recorded with its
hash inside ``release.json``.

Packages are written once. The run they came from is only ever read.
"""

from __future__ import annotations

import shutil
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import orjson
from pydantic import ValidationError

from maingott_reel.config import Settings
from maingott_reel.errors import ReleaseError
from maingott_reel.logging_config import get_logger
from maingott_reel.models import (
    ApprovalRecord,
    ArtifactFingerprint,
    ReleaseFile,
    ReleaseManifest,
    package_root,
)
from maingott_reel.release.configuration import snapshot
from maingott_reel.release.inputs import ReleaseInputs
from maingott_reel.utils.hashing import sha256_file
from maingott_reel.utils.jsonio import read_model, write_model
from maingott_reel.utils.run_context import RunContext

logger = get_logger("release.package")

#: The finished Reel, inside the package.
FINAL_NAME = "final/maingott_reel.mp4"

#: Metadata a release must carry to be auditable on its own.
REQUIRED_METADATA = (
    "manifest",
    "validation",
    "composition",
    "storyboard",
    "plan",
    "creative_brief",
    "facts",
    "assets",
    "configuration",
    "approval",
)

#: Metadata that is copied when the run has it.
OPTIONAL_METADATA = ("voice", "source", "review", "generation_plan", "provider_requests")


@dataclass(frozen=True)
class ReleasePackage:
    """A built release package on disk."""

    root: Path
    manifest: ReleaseManifest

    @property
    def release_id(self) -> str:
        """The immutable content id of this release."""
        return self.manifest.release_id

    @property
    def final_video(self) -> Path:
        """The released Reel."""
        return self.root / FINAL_NAME

    @property
    def release_json(self) -> Path:
        """The package's own manifest."""
        return self.root / "release.json"


def _sources(run: RunContext, inputs: ReleaseInputs) -> dict[str, Path]:
    """Map each packaged name to the file in the run it comes from."""
    return {
        "manifest": run.manifest_json,
        "validation": run.validation_json,
        "composition": run.composition_json,
        "storyboard": run.storyboard_json,
        "plan": run.script_json,
        "creative_brief": run.creative_brief_json,
        "facts": run.facts_json,
        "assets": run.assets_json,
        "configuration": run.configuration_json,
        "approval": run.approval_json,
        "voice": run.voice_json,
        "source": run.source_json,
        "review": run.review_json,
        "generation_plan": run.generation_plan_json,
        "provider_requests": run.provider_log,
    }


def build(
    settings: Settings,
    inputs: ReleaseInputs,
    fingerprint: ArtifactFingerprint,
    approval: ApprovalRecord,
    created_at: datetime | None = None,
) -> ReleasePackage:
    """Write the immutable release package for an approved Reel.

    Building the same approved content twice produces the same release id and
    the same directory; an existing package that still validates is returned
    untouched.

    Raises:
        ReleaseError: a required artifact is missing, the approval does not
            describe this content, or a different release already occupies
            this id.
    """
    if not approval.covers(fingerprint):
        raise ReleaseError("the approval does not describe this Reel; approve it again.")
    if inputs.composition.development:
        raise ReleaseError("a development Reel must never be packaged as a release.")

    run = inputs.run
    final = inputs.final_path
    if not final.is_file():
        raise ReleaseError(f"the finished Reel is missing: {final}")

    sources = _sources(run, inputs)
    missing = [name for name in REQUIRED_METADATA if not sources[name].is_file()]
    if missing:
        raise ReleaseError(
            f"run {run.run_id} cannot be released: missing {', '.join(sorted(missing))}."
        )

    root = package_root(settings.releases_root, fingerprint.release_id)
    existing = _load_existing(root)
    if existing is not None:
        logger.info("release already exists", extra={"release_id": existing.release_id})
        return existing
    if root.exists() and any(root.iterdir()):
        raise ReleaseError(
            f"{root} already exists but does not hold a readable release. "
            "Move it aside rather than overwriting a release."
        )

    files: list[ReleaseFile] = [_copy(final, root, FINAL_NAME, "final")]
    for name in (*REQUIRED_METADATA, *OPTIONAL_METADATA):
        source = sources[name]
        if not source.is_file():
            continue
        files.append(_copy(source, root, f"metadata/{source.name}", name))

    probe = inputs.composition
    manifest = ReleaseManifest(
        release_id=fingerprint.release_id,
        release_version=approval.release_version,
        run_id=run.run_id,
        created_at=created_at or datetime.now(tz=UTC),
        fingerprint=fingerprint,
        approval_sha256=approval.sha256,
        approved_by=approval.approved_by,
        approved_at=approval.approved_at,
        configuration=snapshot(settings),
        text_provider=inputs.plan.provenance.provider,
        video_provider=inputs.assets.provider,
        video_model=inputs.assets.model,
        voice_provider=probe.audio.voice_provider or "unknown",
        voice_model=probe.audio.voice_model or "unknown",
        voice_name=probe.audio.voice_name or "unknown",
        development=probe.development,
        duration_seconds=probe.timeline_duration_seconds,
        width=probe.settings.width,
        height=probe.settings.height,
        files=files,
    )
    write_model(root / "release.json", manifest)
    logger.info(
        "release package written",
        extra={
            "release_id": manifest.release_id,
            "release_version": manifest.release_version,
            "path": str(root),
            "files": len(files),
        },
    )
    return ReleasePackage(root=root, manifest=manifest)


def _copy(source: Path, root: Path, relative: str, name: str) -> ReleaseFile:
    """Copy one artifact into the package and record what was copied."""
    destination = root / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)
    return ReleaseFile(
        name=name,
        path=relative,
        sha256=sha256_file(destination),
        size_bytes=destination.stat().st_size,
    )


def _load_existing(root: Path) -> ReleasePackage | None:
    """Return an already-built package when it is still intact."""
    manifest_path = root / "release.json"
    if not manifest_path.is_file():
        return None
    try:
        manifest = read_model(manifest_path, ReleaseManifest)
    except (ValidationError, orjson.JSONDecodeError, OSError):
        return None
    package = ReleasePackage(root=root, manifest=manifest)
    return package if not validate(package).failures else None


@dataclass(frozen=True)
class ReleaseValidation:
    """Whether a release package is still exactly what was released."""

    root: Path
    manifest: ReleaseManifest | None
    checks: list[tuple[str, bool, str]]

    @property
    def failures(self) -> list[tuple[str, bool, str]]:
        """Every check that did not pass."""
        return [check for check in self.checks if not check[1]]

    @property
    def passed(self) -> bool:
        """Whether the package is intact."""
        return self.manifest is not None and not self.failures

    def summary(self) -> str:
        """One line describing the outcome."""
        passed = len(self.checks) - len(self.failures)
        return f"{passed}/{len(self.checks)} package checks passed"


def load(settings: Settings, release_id: str) -> ReleasePackage:
    """Load a release package by id.

    Raises:
        ReleaseError: no such release, or its manifest is unreadable.
    """
    root = package_root(settings.releases_root, release_id)
    manifest_path = root / "release.json"
    if not manifest_path.is_file():
        raise ReleaseError(f"no release package at {root}")
    try:
        return ReleasePackage(root=root, manifest=read_model(manifest_path, ReleaseManifest))
    except (ValidationError, orjson.JSONDecodeError, OSError) as error:
        raise ReleaseError(f"the release manifest at {manifest_path} is unreadable: {error}") from (
            error
        )


def latest(settings: Settings) -> str | None:
    """Return the most recently written release id, if any."""
    root = settings.releases_root
    if not root.is_dir():
        return None
    packages = [
        path for path in root.iterdir() if path.is_dir() and (path / "release.json").is_file()
    ]
    if not packages:
        return None
    return max(packages, key=lambda path: path.stat().st_mtime).name


def validate(package: ReleasePackage) -> ReleaseValidation:
    """Check that a release package is byte-for-byte what was released."""
    manifest = package.manifest
    checks: list[tuple[str, bool, str]] = []

    checks.append(
        (
            "release_id_matches_the_content",
            manifest.release_id == manifest.fingerprint.release_id,
            manifest.release_id,
        )
    )

    for entry in manifest.files:
        path = package.root / entry.path
        if not path.is_file():
            checks.append((f"file_present::{entry.name}", False, f"{entry.path} is missing"))
            continue
        digest = sha256_file(path)
        checks.append(
            (
                f"file_unchanged::{entry.name}",
                digest == entry.sha256,
                f"sha256 {digest[:12]}"
                if digest == entry.sha256
                else f"{entry.path} changed since it was released",
            )
        )

    missing = [name for name in REQUIRED_METADATA if manifest.file(name) is None]
    checks.append(
        (
            "required_metadata_present",
            not missing,
            f"missing: {', '.join(missing)}" if missing else f"{len(manifest.files)} files",
        )
    )

    final = package.final_video
    if final.is_file():
        digest = sha256_file(final)
        checks.append(
            (
                "final_matches_the_fingerprint",
                digest == manifest.fingerprint.final_sha256,
                f"sha256 {digest[:12]}"
                if digest == manifest.fingerprint.final_sha256
                else "the released Reel is not the Reel that was approved",
            )
        )
    else:
        checks.append(("final_matches_the_fingerprint", False, "the released Reel is missing"))

    approval_file = manifest.file("approval")
    if approval_file is not None:
        approval_path = package.root / approval_file.path
        approval = _read_approval(approval_path)
        if approval is None:
            checks.append(("approval_is_readable", False, "approval.json cannot be read"))
        else:
            checks.append(("approval_is_readable", True, str(approval_path)))
            checks.append(
                (
                    "approval_matches_the_release",
                    approval.sha256 == manifest.approval_sha256
                    and approval.covers(manifest.fingerprint)
                    and approval.approves,
                    f"approved by {approval.approved_by}"
                    if approval.sha256 == manifest.approval_sha256
                    and approval.covers(manifest.fingerprint)
                    and approval.approves
                    else "the packaged approval does not describe this release",
                )
            )
    return ReleaseValidation(root=package.root, manifest=manifest, checks=checks)


def _read_approval(path: Path) -> ApprovalRecord | None:
    """Read a packaged approval record, or ``None`` when it is unreadable."""
    if not path.is_file():
        return None
    try:
        return read_model(path, ApprovalRecord)
    except (ValidationError, orjson.JSONDecodeError, OSError):
        return None
