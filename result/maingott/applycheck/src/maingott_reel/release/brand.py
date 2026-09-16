"""Reading the approved brand registry and voice profile.

These files are read, never written. This project cannot approve a logo or a
voice on anyone's behalf: it can only check that a human wrote the approval
down, and that the file in front of it is still the one they approved.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import orjson
from pydantic import ValidationError

from maingott_reel.config import Settings
from maingott_reel.errors import ConfigurationError
from maingott_reel.logging_config import get_logger
from maingott_reel.models import AssetType, BrandAsset, BrandRegistry, VoiceProfile
from maingott_reel.utils.hashing import sha256_file
from maingott_reel.utils.jsonio import read_model

logger = get_logger("release.brand")


@dataclass(frozen=True)
class AssetApproval:
    """Whether one file is an approved brand asset, and why not if it is not."""

    approved: bool
    asset: BrandAsset | None
    reason: str

    @property
    def asset_id(self) -> str | None:
        """The registered id, when the file is registered at all."""
        return self.asset.asset_id if self.asset else None


def load_registry(settings: Settings) -> BrandRegistry | None:
    """Load ``brand.json``, or ``None`` when there is none.

    A malformed registry is never interpreted as an approval — and it is not
    reported as *absent* either, because "you have no registry" and "your
    registry does not parse" need different answers from a human.

    Raises:
        ConfigurationError: the file exists but cannot be read.
    """
    path = settings.brand_registry_path
    if not path.is_file():
        return None
    try:
        return read_model(path, BrandRegistry)
    except (ValidationError, orjson.JSONDecodeError, OSError) as error:
        raise ConfigurationError(
            f"The brand registry at {path} cannot be read: {error}. Fix it or remove it — "
            "a malformed registry must not be mistaken for an absent one."
        ) from error


def load_voice_profile(settings: Settings) -> VoiceProfile | None:
    """Load ``voice_profile.json``, or ``None`` when there is none.

    Raises:
        ConfigurationError: the file exists but cannot be read.
    """
    path = settings.voice_profile_path
    if not path.is_file():
        return None
    try:
        return read_model(path, VoiceProfile)
    except (ValidationError, orjson.JSONDecodeError, OSError) as error:
        raise ConfigurationError(
            f"The voice profile at {path} cannot be read: {error}. Fix it or remove it — "
            "a malformed profile must not be mistaken for an absent one."
        ) from error


def check_asset(
    registry: BrandRegistry | None,
    path: Path | None,
    asset_type: AssetType,
    sha256: str | None = None,
) -> AssetApproval:
    """Decide whether ``path`` is an approved brand asset of ``asset_type``.

    The file's *content* decides: a registry entry only counts when the hash
    on disk still matches the hash a human approved.
    """
    if path is None:
        return AssetApproval(False, None, f"no {asset_type.value} was used")
    if registry is None:
        return AssetApproval(False, None, "there is no brand registry, so nothing is approved")
    if not path.is_file():
        return AssetApproval(False, None, f"{path} does not exist")

    digest = sha256 or sha256_file(path)
    entry = registry.find_by_hash(digest)
    if entry is None:
        named = registry.find_by_path(path)
        if named is not None:
            return AssetApproval(
                False,
                named,
                f"{path.name} does not match the approved '{named.asset_id}' "
                f"(sha256 {digest[:12]} vs {named.sha256[:12]})",
            )
        return AssetApproval(False, None, f"{path.name} is not in the brand registry")
    if entry.asset_type is not asset_type:
        return AssetApproval(
            False, entry, f"'{entry.asset_id}' is registered as a {entry.asset_type.value}"
        )
    if not entry.approved:
        return AssetApproval(False, entry, f"'{entry.asset_id}' is registered but not approved")
    return AssetApproval(True, entry, f"'{entry.asset_id}' v{entry.version}, approved")


def approved_logo(settings: Settings) -> BrandAsset | None:
    """Return the approved logo, when the registry names one that exists."""
    registry = load_registry(settings)
    if registry is None:
        return None
    for asset in registry.approved_assets(AssetType.IMAGE):
        path = Path(asset.path)
        if path.is_file() and sha256_file(path) == asset.sha256:
            return asset
    return None
