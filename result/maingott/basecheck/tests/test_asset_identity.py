"""Asset identity and cache keys."""

from __future__ import annotations

from dataclasses import replace

from maingott_reel.assets.identity import AssetRequest, normalize_prompt
from maingott_reel.models import AssetType, DurationStrategy

SOURCE = "a" * 64


def _request(**overrides: object) -> AssetRequest:
    fields: dict[str, object] = {
        "scene_id": "S-01",
        "beat_id": "B-01",
        "asset_type": AssetType.VIDEO,
        "prompt": "A dark room where light converges into one calm core.",
        "provider": "openai",
        "model": "sora-2",
        "requested_duration_seconds": 3.83,
        "generated_seconds": 4,
        "width": 720,
        "height": 1280,
        "duration_strategy": DurationStrategy.TRIM_IN_POST,
        "source_sha256": SOURCE,
        "prompt_version": "1/3",
        "settings": {"generation_version": "1.0"},
    }
    fields.update(overrides)
    return AssetRequest(**fields)  # type: ignore[arg-type]


def test_prompt_whitespace_is_normalized():
    assert normalize_prompt("  a   dark\nroom  ") == "a dark room"


def test_identity_is_stable():
    assert _request().cache_key == _request().cache_key
    assert _request().asset_id == _request().asset_id


def test_the_asset_id_names_its_scene():
    request = _request()
    assert request.asset_id.startswith("S-01-video-")
    assert len(request.asset_id.split("-")[-1]) == 12


def test_cosmetic_prompt_changes_hit_the_same_cache():
    spaced = _request(prompt="A dark room where light   converges into one calm core. ")
    assert spaced.cache_key == _request().cache_key


def test_a_changed_prompt_changes_the_cache_key():
    assert _request(prompt="A bright room.").cache_key != _request().cache_key


def test_a_changed_model_changes_the_cache_key():
    assert _request(model="sora-2-pro").cache_key != _request().cache_key


def test_a_changed_duration_changes_the_cache_key():
    assert _request(generated_seconds=8).cache_key != _request().cache_key


def test_changed_dimensions_change_the_cache_key():
    assert _request(width=1024, height=1792).cache_key != _request().cache_key


def test_a_changed_provider_changes_the_cache_key():
    assert _request(provider="fake").cache_key != _request().cache_key


def test_changed_generation_settings_change_the_cache_key():
    assert _request(settings={"generation_version": "2.0"}).cache_key != _request().cache_key


def test_the_scene_does_not_change_the_cache_key():
    other_scene = _request(scene_id="S-07", beat_id="B-07")
    assert other_scene.cache_key == _request().cache_key
    assert other_scene.asset_id != _request().asset_id


def test_the_source_document_changes_the_asset_id_but_not_the_cache_key():
    other_source = _request(source_sha256="b" * 64)
    assert other_source.cache_key == _request().cache_key
    assert other_source.asset_id != _request().asset_id


def test_the_scene_duration_does_not_change_the_cache_key():
    # Two scenes of different lengths that round to the same clip share footage.
    shorter = _request(requested_duration_seconds=2.5)
    assert shorter.cache_key == _request().cache_key


def test_describe_is_safe_to_log():
    described = _request().describe()
    assert described["scene_id"] == "S-01"
    assert described["size"] == "720x1280"
    assert described["duration_strategy"] == "trim_in_post"
    assert "prompt" not in described


def test_requests_are_immutable():
    request = _request()
    updated = replace(request, model="sora-2-pro")
    assert request.model == "sora-2"
    assert updated.model == "sora-2-pro"
