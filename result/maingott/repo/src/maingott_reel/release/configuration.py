"""The sanitized configuration snapshot.

What produced a Reel has to be reconstructable later, and an approval has to
become invalid when the production configuration changes. Both need a
canonical record of the settings that *affect the output* — and only those.

Secrets never appear here. Neither do paths or log levels: a different working
directory is not a different Reel, and must not invalidate an approval.
"""

from __future__ import annotations

from maingott_reel import __version__
from maingott_reel.config import Settings
from maingott_reel.models import (
    ASSET_GENERATION_VERSION,
    COMPOSITION_VERSION,
    PLANNER_VERSION,
    STORYBOARD_VERSION,
    VOICE_VERSION,
    ConfigurationSnapshot,
)
from maingott_reel.utils.prompts import load_prompt

#: Prompts whose versions are recorded with a run.
PROMPT_NAMES = (
    "system/creative_planner",
    "creative/plan",
    "system/visual_director",
    "creative/storyboard",
    "voice/narration",
)


def prompt_versions(settings: Settings) -> dict[str, str]:
    """Return the version of every prompt the pipeline uses.

    A prompt that cannot be read is recorded as ``missing`` rather than
    silently omitted: a release must not look complete when it is not.
    """
    versions: dict[str, str] = {}
    for name in PROMPT_NAMES:
        try:
            versions[name] = load_prompt(name, settings.prompts_root).version
        except Exception:  # noqa: BLE001 - a missing prompt is data, not a crash
            versions[name] = "missing"
    return versions


def snapshot(settings: Settings) -> ConfigurationSnapshot:
    """Build the sanitized configuration snapshot for ``settings``."""
    return ConfigurationSnapshot(
        pipeline_version=__version__,
        composition_version=COMPOSITION_VERSION,
        planner_version=PLANNER_VERSION,
        storyboard_version=STORYBOARD_VERSION,
        asset_generation_version=ASSET_GENERATION_VERSION,
        voice_version=VOICE_VERSION,
        prompt_versions=prompt_versions(settings),
        text_provider="openai",
        text_model=settings.openai_text_model,
        video_provider="openai",
        video_model=settings.openai_video_model,
        voice_provider=settings.voice_provider,
        voice_model=settings.openai_tts_model,
        voice_name=settings.voice_name,
        voice_format=settings.voice_format.value,
        voice_speed=settings.voice_speed,
        voice_fit_strategy=settings.voice_fit_strategy.value,
        language=settings.reel_language.value,
        target_duration_seconds=settings.default_reel_duration,
        duration_bounds=[settings.min_reel_duration, settings.max_reel_duration],
        width=settings.video_width,
        height=settings.video_height,
        fps=settings.video_fps,
        video_codec="libx264",
        video_crf=settings.video_crf,
        video_preset=settings.video_preset,
        audio_codec="aac",
        audio_bitrate=settings.audio_bitrate,
        transition_seconds=settings.transition_seconds,
        music_gain_db=settings.music_gain_db,
        allow_target_facts=settings.allow_target_facts,
    )


def configuration_sha256(settings: Settings) -> str:
    """Content hash of the sanitized configuration."""
    return snapshot(settings).sha256
