"""Asset identity and cache keys.

Two different hashes, on purpose:

``cache_key``
    everything that defines the *content* of a generated file — provider,
    model, prompt, duration, size, generation settings. Two scenes asking for
    the same footage share it, and any change to the request produces a
    different key.

``asset_id``
    the cache key plus where the asset belongs — the run's source document and
    the scene. It stays stable across re-runs of the same storyboard, so
    resuming a run finds the same ids.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from maingott_reel.models import AssetType, DurationStrategy
from maingott_reel.utils.hashing import sha256_text
from maingott_reel.utils.jsonio import dumps

#: Bumped when the meaning of a request changes and old cache entries must not
#: be reused even though the visible fields look identical.
REQUEST_VERSION = 1

_WHITESPACE = re.compile(r"\s+")


def normalize_prompt(prompt: str) -> str:
    """Collapse whitespace so cosmetic edits do not miss the cache."""
    return _WHITESPACE.sub(" ", prompt).strip()


@dataclass(frozen=True)
class AssetRequest:
    """One asset the storyboard requires, resolved against a provider."""

    scene_id: str
    beat_id: str
    asset_type: AssetType
    prompt: str
    provider: str
    model: str
    requested_duration_seconds: float
    generated_seconds: int
    width: int
    height: int
    duration_strategy: DurationStrategy
    source_sha256: str
    prompt_version: str
    settings: dict[str, Any] = field(default_factory=dict)

    @property
    def normalized_prompt(self) -> str:
        """The prompt as it is sent and hashed."""
        return normalize_prompt(self.prompt)

    @property
    def prompt_hash(self) -> str:
        """Hash of the normalized prompt."""
        return sha256_text(self.normalized_prompt)

    @property
    def cache_key(self) -> str:
        """Content-defining hash, shared across runs and scenes."""
        payload = {
            "version": REQUEST_VERSION,
            "asset_type": self.asset_type.value,
            "provider": self.provider,
            "model": self.model,
            "prompt": self.normalized_prompt,
            "seconds": self.generated_seconds,
            "width": self.width,
            "height": self.height,
            "settings": self.settings,
        }
        return sha256_text(dumps(payload).decode("utf-8"))

    @property
    def asset_id(self) -> str:
        """Stable identity of this asset inside this run."""
        payload = {
            "cache_key": self.cache_key,
            "scene_id": self.scene_id,
            "source_sha256": self.source_sha256,
        }
        digest = sha256_text(dumps(payload).decode("utf-8"))
        return f"{self.scene_id}-{self.asset_type.value}-{digest[:12]}"

    @property
    def size(self) -> tuple[int, int]:
        """Requested frame size."""
        return self.width, self.height

    def describe(self) -> dict[str, Any]:
        """A log- and manifest-safe summary of the request."""
        return {
            "scene_id": self.scene_id,
            "asset_id": self.asset_id,
            "cache_key": self.cache_key,
            "provider": self.provider,
            "model": self.model,
            "seconds": self.generated_seconds,
            "size": f"{self.width}x{self.height}",
            "duration_strategy": self.duration_strategy.value,
            "requested_duration_seconds": self.requested_duration_seconds,
        }
