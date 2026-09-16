"""Provider interfaces.

Phase 0 only guarantees that the protocols exist, that a fake implementation
satisfies them, and that no vendor SDK is imported.
"""

from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel

from maingott_reel.providers import (
    ImageProvider,
    MediaResult,
    TextProvider,
    TextResult,
    Usage,
    VideoCapabilities,
    VideoProvider,
    VoiceProvider,
)


class _Plan(BaseModel):
    headline: str


class FakeTextProvider:
    name = "fake"
    model = "fake-text"

    def generate_structured(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        schema: type[BaseModel],
        temperature: float | None = None,
    ) -> TextResult:
        return TextResult(value=schema.model_construct(), usage=Usage(model="fake-text"))


class FakeMediaProvider:
    name = "fake"
    model = "fake-media"
    capabilities = VideoCapabilities(
        supported_seconds=(4, 8), supported_sizes=((720, 1280),), max_prompt_chars=1000
    )

    def generate_image(
        self, *, prompt: str, width: int, height: int, destination: Path
    ) -> MediaResult:
        return MediaResult(path=destination, usage=Usage(model="fake-image"))

    def generate_video(
        self, *, prompt: str, seconds: int, width: int, height: int, destination: Path
    ) -> MediaResult:
        return MediaResult(path=destination, usage=Usage(model="fake-video"))

    def synthesize(self, *, text: str, voice: str, destination: Path) -> MediaResult:
        return MediaResult(path=destination, usage=Usage(model="fake-voice"))


def test_fake_providers_satisfy_the_protocols():
    text = FakeTextProvider()
    media = FakeMediaProvider()
    assert isinstance(text, TextProvider)
    assert isinstance(media, ImageProvider)
    assert isinstance(media, VideoProvider)
    assert isinstance(media, VoiceProvider)


def test_text_provider_returns_a_validated_value():
    result = FakeTextProvider().generate_structured(
        system_prompt="system", user_prompt="user", schema=_Plan
    )
    assert result.usage.model == "fake-text"
    assert isinstance(result.value, _Plan)


def test_media_result_carries_usage(tmp_path: Path):
    result = FakeMediaProvider().generate_video(
        prompt="scene", seconds=8, width=720, height=1280, destination=tmp_path / "a.mp4"
    )
    assert result.path == tmp_path / "a.mp4"
    assert result.usage.requests == 1


def test_provider_interfaces_do_not_import_a_vendor_sdk():
    source = Path("src/maingott_reel/providers/base.py")
    if not source.is_file():  # running from an installed package
        import maingott_reel.providers.base as base

        source = Path(base.__file__)
    text = source.read_text(encoding="utf-8")
    assert "import openai" not in text
    assert "from openai" not in text


def test_capabilities_answer_what_can_be_asked_for():
    capabilities = VideoCapabilities(
        supported_seconds=(4, 8, 12),
        supported_sizes=((720, 1280), (1280, 720), (1024, 1792)),
        max_prompt_chars=2000,
    )
    assert capabilities.seconds_for(2.5) == 4
    assert capabilities.seconds_for(8.0) == 8
    assert capabilities.seconds_for(30) is None
    assert capabilities.max_seconds == 12
    assert capabilities.portrait_sizes() == ((720, 1280), (1024, 1792))
    assert capabilities.best_portrait_size(1080, 1920) == (720, 1280)
    assert capabilities.supports(12, (1024, 1792))
    assert not capabilities.supports(6, (720, 1280))


def test_a_provider_without_a_portrait_size_says_so():
    capabilities = VideoCapabilities(
        supported_seconds=(4,), supported_sizes=((1280, 720),), max_prompt_chars=100
    )
    assert capabilities.portrait_sizes() == ()
    assert capabilities.best_portrait_size(1080, 1920) is None
