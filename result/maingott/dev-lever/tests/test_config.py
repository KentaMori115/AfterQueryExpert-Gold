"""Settings behaviour."""

from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

from maingott_reel.config import Settings, get_settings, reset_settings_cache
from maingott_reel.errors import ConfigurationError


def test_defaults_match_the_reel_target():
    settings = Settings()
    assert settings.default_reel_duration == 40
    assert (settings.min_reel_duration, settings.max_reel_duration) == (30, 45)
    assert settings.video_width == 1080
    assert settings.video_height == 1920
    assert settings.aspect_ratio == "9:16"


def test_environment_overrides_defaults(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("DEFAULT_REEL_DURATION", "35")
    monkeypatch.setenv("OPENAI_TEXT_MODEL", "test-text-model")
    monkeypatch.setenv("OUTPUT_ROOT", "/tmp/maingott-out")
    settings = Settings()
    assert settings.default_reel_duration == 35
    assert settings.openai_text_model == "test-text-model"
    assert settings.output_root == Path("/tmp/maingott-out")


def test_duration_outside_bounds_is_rejected():
    with pytest.raises(ValidationError):
        Settings(default_reel_duration=90)


def test_landscape_resolution_is_rejected():
    with pytest.raises(ValidationError):
        Settings(video_width=1920, video_height=1080)


def test_invalid_log_level_is_rejected():
    with pytest.raises(ValidationError):
        Settings(log_level="LOUD")


def test_log_level_is_normalised():
    assert Settings(log_level="debug").log_level == "DEBUG"


def test_resolve_duration_uses_default_and_enforces_bounds():
    settings = Settings()
    assert settings.resolve_duration(None) == 40
    assert settings.resolve_duration(32) == 32
    with pytest.raises(ConfigurationError):
        settings.resolve_duration(10)


def test_require_api_key_fails_when_missing():
    with pytest.raises(ConfigurationError):
        Settings().require_api_key()


def test_require_api_key_returns_the_secret():
    assert Settings(openai_api_key="sk-test-value").require_api_key() == "sk-test-value"


def test_secret_is_not_exposed_by_repr_or_describe():
    settings = Settings(openai_api_key="sk-super-secret")
    assert "sk-super-secret" not in repr(settings)
    assert "sk-super-secret" not in str(settings.describe())
    assert settings.describe()["openai_api_key_set"] is True


def test_runs_root_is_derived_from_output_root(tmp_path: Path):
    settings = Settings(output_root=tmp_path / "out")
    assert settings.runs_root == tmp_path / "out" / "runs"


def test_get_settings_is_cached():
    reset_settings_cache()
    assert get_settings() is get_settings()


def test_inverted_duration_bounds_are_rejected():
    with pytest.raises(ValidationError):
        Settings(min_reel_duration=45, max_reel_duration=30)


@pytest.mark.parametrize(
    "name",
    [
        "OPENAI_TEMPERATURE",
        "OPENAI_REASONING_EFFORT",
        "VOICE_INSTRUCTIONS",
        "VOICE_SPEED",
        "VOICE_LANGUAGE",
    ],
)
def test_optional_keys_left_empty_in_env_are_treated_as_unset(
    monkeypatch: pytest.MonkeyPatch, name: str
):
    monkeypatch.setenv(name, "")
    settings = Settings()
    assert getattr(settings, name.lower()) is None


@pytest.mark.parametrize("name", ["OPENAI_TTS_MODEL", "VOICE_PROVIDER", "VOICE_NAME"])
def test_required_keys_left_empty_in_env_fall_back_to_their_default(
    monkeypatch: pytest.MonkeyPatch, name: str
):
    monkeypatch.setenv(name, "")
    settings = Settings()
    value = getattr(settings, name.lower())
    assert value == Settings.model_fields[name.lower()].default
    assert value


def test_reasoning_effort_is_normalised(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("OPENAI_REASONING_EFFORT", "High")
    assert Settings().openai_reasoning_effort == "high"


def test_planner_defaults():
    settings = Settings()
    assert settings.openai_text_model == "gpt-5.6-terra"
    assert settings.reel_language.value == "ru"
    assert settings.allow_target_facts is False
    assert settings.planner_beat_count == 8
    assert settings.prompts_root.is_dir()
