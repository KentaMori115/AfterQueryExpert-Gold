"""The approved brand registry and the approved voice profile."""

from __future__ import annotations

from pathlib import Path

import pytest
from tests.conftest import write_brand_registry, write_voice_profile

from maingott_reel.config import Settings
from maingott_reel.errors import ConfigurationError
from maingott_reel.models import AssetType, BrandAsset, BrandRegistry, Language, VoiceProfile
from maingott_reel.release.brand import (
    approved_logo,
    check_asset,
    load_registry,
    load_voice_profile,
)
from maingott_reel.utils.hashing import sha256_file
from maingott_reel.utils.jsonio import write_model

# --- the registry -------------------------------------------------------------


def test_no_registry_means_nothing_is_approved(settings: Settings, logo_file: Path):
    assert load_registry(settings) is None
    check = check_asset(None, logo_file, AssetType.IMAGE)
    assert not check.approved
    assert "no brand registry" in check.reason


def test_an_approved_logo_is_accepted(settings: Settings, logo_file: Path):
    write_brand_registry(settings, logo=logo_file)
    registry = load_registry(settings)

    check = check_asset(registry, logo_file, AssetType.IMAGE)
    assert check.approved
    assert check.asset_id == "maingott-logo"
    assert approved_logo(settings) is not None


def test_a_registered_but_unapproved_logo_is_rejected(settings: Settings, logo_file: Path):
    write_brand_registry(settings, logo=logo_file, approved=False)
    registry = load_registry(settings)

    check = check_asset(registry, logo_file, AssetType.IMAGE)
    assert not check.approved
    assert "not approved" in check.reason
    assert approved_logo(settings) is None


def test_a_logo_that_changed_since_approval_is_rejected(settings: Settings, logo_file: Path):
    write_brand_registry(settings, logo=logo_file)
    registry = load_registry(settings)
    from PIL import Image

    Image.new("RGBA", (512, 128), (255, 0, 0, 255)).save(logo_file, "PNG")

    check = check_asset(registry, logo_file, AssetType.IMAGE)
    assert not check.approved
    assert "does not match the approved" in check.reason
    assert approved_logo(settings) is None


def test_an_unregistered_logo_is_rejected(settings: Settings, logo_file: Path, tmp_path: Path):
    write_brand_registry(settings, logo=logo_file)
    registry = load_registry(settings)
    other = tmp_path / "other-logo.png"
    from PIL import Image

    Image.new("RGBA", (512, 128), (0, 255, 0, 255)).save(other, "PNG")

    check = check_asset(registry, other, AssetType.IMAGE)
    assert not check.approved
    assert "not in the brand registry" in check.reason


def test_a_missing_logo_is_rejected(settings: Settings, logo_file: Path):
    write_brand_registry(settings, logo=logo_file)
    registry = load_registry(settings)
    logo_file.unlink()

    check = check_asset(registry, logo_file, AssetType.IMAGE)
    assert not check.approved
    assert "does not exist" in check.reason


def test_no_asset_at_all_is_rejected(settings: Settings, logo_file: Path):
    write_brand_registry(settings, logo=logo_file)
    check = check_asset(load_registry(settings), None, AssetType.IMAGE)
    assert not check.approved
    assert "no image was used" in check.reason


def test_an_asset_registered_as_another_type_is_rejected(settings: Settings, logo_file: Path):
    write_model(
        settings.brand_registry_path,
        BrandRegistry(
            assets=[
                BrandAsset(
                    asset_id="mislabelled",
                    asset_type=AssetType.MUSIC,
                    path=logo_file,
                    sha256=sha256_file(logo_file),
                    approved=True,
                    approved_by="Brand Owner",
                )
            ]
        ),
    )
    check = check_asset(load_registry(settings), logo_file, AssetType.IMAGE)
    assert not check.approved
    assert "registered as a music" in check.reason


def test_a_malformed_registry_is_reported_not_ignored(settings: Settings):
    """Found in the pilot: a copied template silently read as "no registry"."""
    settings.brand_registry_path.parent.mkdir(parents=True, exist_ok=True)
    settings.brand_registry_path.write_text("{not json", encoding="utf-8")

    with pytest.raises(ConfigurationError, match="cannot be read"):
        load_registry(settings)


def test_the_shipped_registry_template_loads(settings: Settings, logo_file: Path):
    """A template nobody can copy is not a template."""
    import shutil

    example = Path(__file__).resolve().parents[1] / "input/brand/brand.example.json"
    settings.brand_registry_path.parent.mkdir(parents=True, exist_ok=True)
    payload = example.read_text(encoding="utf-8").replace(
        "<sha256 of the approved file>", sha256_file(logo_file)
    )
    settings.brand_registry_path.write_text(payload, encoding="utf-8")

    registry = load_registry(settings)
    assert registry is not None
    assert registry.note, "the note in the template is carried, not rejected"
    assert not registry.approved_assets(AssetType.IMAGE), "a template approves nothing"
    assert shutil


def test_an_approval_has_to_name_somebody():
    from pydantic import ValidationError

    with pytest.raises(ValidationError, match="by nobody"):
        BrandAsset(
            asset_id="x",
            asset_type=AssetType.IMAGE,
            path=Path("logo.png"),
            sha256="a" * 64,
            approved=True,
        )


def test_registered_ids_are_unique(logo_file: Path):
    from pydantic import ValidationError

    asset = BrandAsset(
        asset_id="same",
        asset_type=AssetType.IMAGE,
        path=logo_file,
        sha256=sha256_file(logo_file),
    )
    with pytest.raises(ValidationError, match="unique"):
        BrandRegistry(assets=[asset, asset])


# --- the voice profile ---------------------------------------------------------


def test_no_profile_means_no_approved_voice(settings: Settings):
    assert load_voice_profile(settings) is None


def test_an_approved_profile_is_read(settings: Settings):
    write_voice_profile(settings)
    profile = load_voice_profile(settings)

    assert profile is not None
    assert profile.approved
    assert profile.matches("openai", "gpt-4o-mini-tts", "marin", Language.RU)
    assert "marin" in profile.describe()


def test_a_profile_only_matches_the_exact_voice(settings: Settings):
    write_voice_profile(settings)
    profile = load_voice_profile(settings)
    assert profile is not None

    assert not profile.matches("openai", "gpt-4o-mini-tts", "cedar", Language.RU)
    assert not profile.matches("openai", "tts-1", "marin", Language.RU)
    assert not profile.matches("fake", "offline-voice", "marin", Language.RU)
    assert not profile.matches("openai", "gpt-4o-mini-tts", "marin", Language.EN)


def test_an_unapproved_profile_says_so(settings: Settings):
    write_voice_profile(settings, approved=False)
    profile = load_voice_profile(settings)
    assert profile is not None and not profile.approved


def test_a_voice_approval_has_to_name_somebody():
    from pydantic import ValidationError

    with pytest.raises(ValidationError, match="by nobody"):
        VoiceProfile(provider="openai", model="gpt-4o-mini-tts", voice="marin", approved=True)


def test_a_malformed_profile_is_reported_not_ignored(settings: Settings):
    settings.voice_profile_path.parent.mkdir(parents=True, exist_ok=True)
    settings.voice_profile_path.write_text("{not json", encoding="utf-8")

    with pytest.raises(ConfigurationError, match="cannot be read"):
        load_voice_profile(settings)


def test_the_shipped_voice_profile_template_loads(settings: Settings):
    example = Path(__file__).resolve().parents[1] / "input/brand/voice_profile.example.json"
    settings.voice_profile_path.parent.mkdir(parents=True, exist_ok=True)
    settings.voice_profile_path.write_text(example.read_text(encoding="utf-8"), encoding="utf-8")

    profile = load_voice_profile(settings)
    assert profile is not None
    assert not profile.approved, "a template approves nothing"
