"""Release, approval and human review schemas.

Everything before this point can be decided mechanically. Releasing cannot:
automated gates establish that a Reel is *technically* correct and traceable,
never that it is *right*. So a release has two halves — a machine-checked
production readiness state, and a human approval bound to the exact bytes that
were approved.

An approval is a statement about one artifact. Change the Reel, the script,
the narration or the production configuration and the approval no longer
describes what exists, and this module says so rather than quietly carrying it
forward.
"""

from __future__ import annotations

import re
from datetime import datetime
from enum import StrEnum
from pathlib import Path

from pydantic import Field, model_validator

from maingott_reel.models.base import SCHEMA_VERSION, Schema
from maingott_reel.utils.hashing import sha256_text
from maingott_reel.utils.jsonio import dumps

#: Bumped when the meaning of an approval or a release package changes.
APPROVAL_VERSION = "1.0"
RELEASE_PACKAGE_VERSION = "1.0"

#: Release versions are chosen by a human and look like ``v1.0.0``.
RELEASE_VERSION_PATTERN = r"^v\d+\.\d+\.\d+$"
DEFAULT_RELEASE_VERSION = "v1.0.0"

_VERSION = re.compile(RELEASE_VERSION_PATTERN)


class ReleaseState(StrEnum):
    """Where a run stands on the way to being publishable."""

    DRAFT = "draft"
    """Not validated, or validation failed."""

    VALIDATED = "validated"
    """Every blocking quality gate passes, but the Reel is a development output."""

    RELEASE_CANDIDATE = "release_candidate"
    """Production-ready by every mechanical check. Awaiting a human."""

    APPROVED = "approved"
    """A human approved these exact bytes."""

    REJECTED = "rejected"
    """A human rejected these exact bytes."""


class ReleaseOutcome(StrEnum):
    """The verdict of ``release-check``."""

    PASS = "pass"
    """A release candidate: a human may now review and approve it."""

    BLOCKED = "blocked"
    """A valid Reel that must not be released — development inputs, or
    something a human has not approved."""

    FAIL = "fail"
    """Not a valid Reel at all: a blocking quality gate failed."""


class ApprovalStatus(StrEnum):
    """What a human decided."""

    APPROVED = "approved"
    REJECTED = "rejected"


class ArtifactFingerprint(Schema):
    """The hashes that identify one Reel's content, end to end.

    This is what an approval is bound to. Any change anywhere in the chain —
    the specification, the script, the storyboard, the footage, the narration,
    the composition, the finished file, or the production configuration —
    produces a different fingerprint.
    """

    source_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    plan_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    storyboard_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    assets_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    voice_sha256: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    narration_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    composition_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    final_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    configuration_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")

    @property
    def identity(self) -> str:
        """A content hash of every field. Never derived from a timestamp."""
        return sha256_text(dumps(self.model_dump(mode="json")).decode("utf-8"))

    @property
    def release_id(self) -> str:
        """The immutable id of the release this content would produce."""
        return f"rel-{self.identity[:16]}"

    def differences(self, other: ArtifactFingerprint) -> list[str]:
        """Name every field where the two fingerprints disagree."""
        mine = self.model_dump(mode="json")
        theirs = other.model_dump(mode="json")
        return sorted(key for key in mine if mine[key] != theirs[key])


class ReviewItem(Schema):
    """One judgement only a human can make."""

    id: str = Field(min_length=1)
    question: str = Field(min_length=1)
    category: str = "general"
    confirmed: bool = False
    confirmed_by: str | None = None
    confirmed_at: datetime | None = None
    note: str | None = None

    @model_validator(mode="after")
    def _confirmation_is_attributable(self) -> ReviewItem:
        if self.confirmed and not self.confirmed_by:
            raise ValueError(f"review item {self.id} is confirmed but by nobody")
        return self


class ReviewChecklist(Schema):
    """The human review of one exact Reel.

    Bound to ``final_sha256``: a re-composed Reel is a different Reel and has
    to be looked at again.
    """

    schema_version: int = SCHEMA_VERSION
    version: str = APPROVAL_VERSION
    run_id: str = Field(min_length=1)
    final_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    created_at: datetime
    updated_at: datetime | None = None
    items: list[ReviewItem] = Field(min_length=1)

    @model_validator(mode="after")
    def _unique_items(self) -> ReviewChecklist:
        ids = [item.id for item in self.items]
        if len(set(ids)) != len(ids):
            raise ValueError("review item ids must be unique")
        return self

    @property
    def outstanding(self) -> list[ReviewItem]:
        """Everything a human has not confirmed yet."""
        return [item for item in self.items if not item.confirmed]

    @property
    def complete(self) -> bool:
        """Whether every item has been confirmed."""
        return not self.outstanding

    @property
    def sha256(self) -> str:
        """Content hash of the completed review, recorded in the approval."""
        return sha256_text(dumps(self.model_dump(mode="json")).decode("utf-8"))

    def get(self, item_id: str) -> ReviewItem | None:
        """Return one item by id."""
        return next((item for item in self.items if item.id == item_id), None)

    def summary(self) -> str:
        """One line describing how much is done."""
        done = len(self.items) - len(self.outstanding)
        return f"{done}/{len(self.items)} human review items confirmed"


class ApprovalRecord(Schema):
    """A human decision about one exact Reel."""

    schema_version: int = SCHEMA_VERSION
    version: str = APPROVAL_VERSION
    run_id: str = Field(min_length=1)
    release_version: str = Field(pattern=RELEASE_VERSION_PATTERN)
    status: ApprovalStatus
    approved_by: str = Field(min_length=1)
    approved_at: datetime
    notes: str | None = None
    fingerprint: ArtifactFingerprint
    review_sha256: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")

    @property
    def final_sha256(self) -> str:
        """The exact file this decision is about."""
        return self.fingerprint.final_sha256

    @property
    def sha256(self) -> str:
        """Content hash of the decision itself, recorded in the release."""
        return sha256_text(dumps(self.model_dump(mode="json")).decode("utf-8"))

    @property
    def approves(self) -> bool:
        """Whether this record approves rather than rejects."""
        return self.status is ApprovalStatus.APPROVED

    def covers(self, fingerprint: ArtifactFingerprint) -> bool:
        """Whether this decision describes the content in front of us."""
        return self.fingerprint.identity == fingerprint.identity


class ConfigurationSnapshot(Schema):
    """The production-relevant configuration, with no secrets in it.

    Only what changes the output belongs here: the log level or a filesystem
    path must not invalidate an approval, and a model or a voice must.
    """

    schema_version: int = SCHEMA_VERSION
    pipeline_version: str = Field(min_length=1)
    composition_version: str = Field(min_length=1)
    planner_version: str = Field(min_length=1)
    storyboard_version: str = Field(min_length=1)
    asset_generation_version: str = Field(min_length=1)
    voice_version: str = Field(min_length=1)
    prompt_versions: dict[str, str] = Field(default_factory=dict)

    text_provider: str
    text_model: str
    video_provider: str
    video_model: str
    voice_provider: str
    voice_model: str
    voice_name: str
    voice_format: str
    voice_speed: float | None = None
    voice_fit_strategy: str

    language: str
    target_duration_seconds: int
    duration_bounds: list[int] = Field(min_length=2, max_length=2)
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    fps: int = Field(gt=0)
    video_codec: str
    video_crf: int
    video_preset: str
    audio_codec: str
    audio_bitrate: str
    transition_seconds: float
    music_gain_db: float
    allow_target_facts: bool

    @property
    def sha256(self) -> str:
        """Content hash of the snapshot."""
        return sha256_text(dumps(self.model_dump(mode="json")).decode("utf-8"))


class ReleaseFile(Schema):
    """One file inside a release package."""

    name: str = Field(min_length=1)
    path: str = Field(min_length=1, description="Relative to the package root")
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    size_bytes: int = Field(ge=0)


class ReleaseManifest(Schema):
    """The self-contained description of one immutable release package."""

    schema_version: int = SCHEMA_VERSION
    package_version: str = RELEASE_PACKAGE_VERSION
    release_id: str = Field(pattern=r"^rel-[0-9a-f]{16}$")
    release_version: str = Field(pattern=RELEASE_VERSION_PATTERN)
    run_id: str = Field(min_length=1)
    created_at: datetime
    fingerprint: ArtifactFingerprint
    approval_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    approved_by: str = Field(min_length=1)
    approved_at: datetime
    configuration: ConfigurationSnapshot
    text_provider: str
    video_provider: str
    video_model: str
    voice_provider: str
    voice_model: str
    voice_name: str
    development: bool = False
    duration_seconds: float = Field(gt=0)
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    files: list[ReleaseFile] = Field(min_length=1)

    @model_validator(mode="after")
    def _identity_matches_the_content(self) -> ReleaseManifest:
        if self.release_id != self.fingerprint.release_id:
            raise ValueError("release_id does not match the fingerprint it claims to describe")
        if self.development:
            raise ValueError("a development Reel must never be packaged as a release")
        return self

    def file(self, name: str) -> ReleaseFile | None:
        """Return one packaged file by name."""
        return next((item for item in self.files if item.name == name), None)


def is_release_version(value: str) -> bool:
    """Whether ``value`` is a well-formed release version such as ``v1.2.3``."""
    return bool(_VERSION.match(value))


def package_root(releases_root: Path, release_id: str) -> Path:
    """Directory holding one release package."""
    return releases_root / release_id
