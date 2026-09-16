"""The voice providers.

The OpenAI adapter is driven by a stub SDK client: no key, no network, no paid
generation. The offline provider writes real audio.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from openai import APIConnectionError, AuthenticationError, BadRequestError, RateLimitError

from maingott_reel.audio.wav import parse_wav
from maingott_reel.config import Settings
from maingott_reel.errors import ConfigurationError, ProviderError, TransientProviderError
from maingott_reel.models import AudioFormat, Language
from maingott_reel.providers.fake import (
    OFFLINE_VOICE_CAPABILITIES,
    OFFLINE_VOICE_NAME,
    OfflineVoiceProvider,
    transient_failure,
)
from maingott_reel.providers.openai_provider import (
    OPENAI_VOICES,
    TTS_CAPABILITIES,
    OpenAIVoiceProvider,
)
from maingott_reel.providers.placeholder_voice import estimated_seconds, render_placeholder_voice

NARRATION = "Клиенты приходят из разных каналов. MainGott соединяет их в одну платформу."


class _Content:
    def __init__(self, payload: bytes = b"RIFF" + b"x" * 4096) -> None:
        self._payload = payload

    def write_to_file(self, path: Path) -> None:
        Path(path).write_bytes(self._payload)


class _Speech:
    def __init__(self, results: list[Any] | None = None) -> None:
        self._results = list(results or [_Content()])
        self.calls: list[dict[str, Any]] = []

    def create(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        result = self._results.pop(0) if len(self._results) > 1 else self._results[0]
        if isinstance(result, Exception):
            raise result
        return result


class _Client:
    def __init__(self, speech: _Speech) -> None:
        self.audio = type("Audio", (), {"speech": speech})()


def _api_error(kind: type, message: str = "boom") -> Exception:
    request = type("Request", (), {"method": "POST", "url": "/v1/audio/speech"})()
    response = type("HTTPResponse", (), {"status_code": 429, "headers": {}, "request": request})()
    if kind is APIConnectionError:
        return APIConnectionError(request=request)
    return kind(message, response=response, body=None)


def _settings(**overrides: Any) -> Settings:
    defaults: dict[str, Any] = {"openai_api_key": "sk-test-key", "openai_max_retries": 3}
    defaults.update(overrides)
    return Settings(**defaults)


def _provider(speech: _Speech, **overrides: Any) -> OpenAIVoiceProvider:
    return OpenAIVoiceProvider(_settings(**overrides), client=_Client(speech))


def _synthesize(provider: OpenAIVoiceProvider, destination: Path, **overrides: Any) -> Any:
    request: dict[str, Any] = {
        "text": NARRATION,
        "voice": "marin",
        "language": Language.RU,
        "audio_format": AudioFormat.WAV,
        "destination": destination,
        "instructions": "Calm and confident.",
    }
    request.update(overrides)
    return provider.synthesize(**request)


# --- capabilities -------------------------------------------------------------


def test_capabilities_match_the_documented_contract():
    assert TTS_CAPABILITIES.max_input_chars == 4096
    assert TTS_CAPABILITIES.speed_range == (0.25, 4.0)
    assert TTS_CAPABILITIES.supports_instructions
    assert AudioFormat.WAV in TTS_CAPABILITIES.supported_formats
    assert Language.RU in TTS_CAPABILITIES.supported_languages
    for voice in ("alloy", "marin", "cedar", "coral", "fable", "nova", "onyx"):
        assert voice in OPENAI_VOICES


def test_the_older_models_do_not_take_voice_direction():
    provider = _provider(_Speech(), openai_tts_model="tts-1-hd")
    assert not provider.capabilities.supports_instructions
    assert provider.capabilities.supported_voices == TTS_CAPABILITIES.supported_voices


def test_provider_identity():
    provider = _provider(_Speech())
    assert provider.name == "openai"
    assert provider.model == "gpt-4o-mini-tts"


def test_a_missing_api_key_is_reported_before_any_call():
    with pytest.raises(ConfigurationError, match="OPENAI_API_KEY"):
        OpenAIVoiceProvider(Settings())


# --- request construction -------------------------------------------------------


def test_the_request_carries_the_narration_verbatim(tmp_path: Path):
    speech = _Speech()
    destination = tmp_path / "voice.wav"

    result = _synthesize(_provider(speech), destination)

    assert speech.calls[0] == {
        "model": "gpt-4o-mini-tts",
        "voice": "marin",
        "input": NARRATION,
        "response_format": "wav",
        "instructions": "Calm and confident.",
    }
    assert destination.is_file()
    assert result.path == destination
    assert result.metadata["instructions_applied"] is True


def test_a_speaking_speed_is_passed_through(tmp_path: Path):
    speech = _Speech()
    _synthesize(_provider(speech), tmp_path / "voice.wav", speed=1.1)
    assert speech.calls[0]["speed"] == 1.1


def test_voice_direction_is_dropped_for_models_that_reject_it(tmp_path: Path):
    speech = _Speech()
    provider = _provider(speech, openai_tts_model="tts-1")
    _synthesize(provider, tmp_path / "voice.wav")

    assert "instructions" not in speech.calls[0]
    assert speech.calls[0]["input"] == NARRATION


# --- unsupported requests ---------------------------------------------------------


def test_an_unknown_voice_is_refused_before_the_call(tmp_path: Path):
    speech = _Speech()
    with pytest.raises(ProviderError, match="does not offer the voice"):
        _synthesize(_provider(speech), tmp_path / "voice.wav", voice="morgan")
    assert not speech.calls


def test_narration_longer_than_the_limit_is_refused(tmp_path: Path):
    speech = _Speech()
    with pytest.raises(ProviderError, match="accepts at most"):
        _synthesize(_provider(speech), tmp_path / "voice.wav", text="я" * 5000)
    assert not speech.calls


def test_empty_narration_is_refused(tmp_path: Path):
    with pytest.raises(ProviderError, match="no narration"):
        _synthesize(_provider(_Speech()), tmp_path / "voice.wav", text="   ")


def test_an_unsupported_speed_is_refused(tmp_path: Path):
    with pytest.raises(ProviderError, match="speaking speeds"):
        _synthesize(_provider(_Speech()), tmp_path / "voice.wav", speed=9.0)


# --- API failures --------------------------------------------------------------------


def test_authentication_failure_is_a_configuration_error(tmp_path: Path):
    speech = _Speech([_api_error(AuthenticationError)])
    with pytest.raises(ConfigurationError, match="credentials"):
        _synthesize(_provider(speech), tmp_path / "voice.wav")


def test_a_rejected_request_is_a_provider_error(tmp_path: Path):
    speech = _Speech([_api_error(BadRequestError)])
    with pytest.raises(ProviderError, match="rejected the speech request"):
        _synthesize(_provider(speech), tmp_path / "voice.wav")


def test_rate_limits_are_retried_then_reported(tmp_path: Path):
    speech = _Speech([_api_error(RateLimitError)])
    with pytest.raises(TransientProviderError, match="unavailable"):
        _synthesize(_provider(speech, openai_max_retries=2), tmp_path / "voice.wav")
    assert len(speech.calls) == 2


def test_a_transient_failure_is_retried_and_can_succeed(tmp_path: Path):
    speech = _Speech([_api_error(APIConnectionError), _Content()])
    destination = tmp_path / "voice.wav"

    _synthesize(_provider(speech), destination)

    assert destination.is_file()
    assert len(speech.calls) == 2


def test_empty_audio_is_refused(tmp_path: Path):
    speech = _Speech([_Content(b"")])
    destination = tmp_path / "voice.wav"

    with pytest.raises(ProviderError, match="empty audio"):
        _synthesize(_provider(speech), destination)
    assert not destination.exists()
    assert not list(tmp_path.glob(".*"))


def test_a_response_that_carries_no_audio_is_refused(tmp_path: Path):
    class _NoAudio:
        pass

    speech = _Speech([_NoAudio()])
    with pytest.raises(ProviderError, match="no audio"):
        _synthesize(_provider(speech), tmp_path / "voice.wav")


# --- the offline provider ---------------------------------------------------------------


def test_the_offline_provider_writes_real_audio(tmp_path: Path):
    provider = OfflineVoiceProvider()
    destination = tmp_path / "voice.wav"

    result = provider.synthesize(
        text=NARRATION,
        voice=OFFLINE_VOICE_NAME,
        language=Language.RU,
        audio_format=AudioFormat.WAV,
        destination=destination,
    )

    info = parse_wav(destination)
    assert info.frames > 0
    assert info.sample_rate == 24000
    assert result.duration_seconds == pytest.approx(info.duration_seconds, abs=0.05)
    assert result.metadata["development"] is True
    assert provider.name == "fake"


def test_the_offline_provider_is_deterministic(tmp_path: Path):
    provider = OfflineVoiceProvider()
    first = tmp_path / "a.wav"
    second = tmp_path / "b.wav"
    for destination in (first, second):
        provider.synthesize(
            text=NARRATION,
            voice=OFFLINE_VOICE_NAME,
            language=Language.RU,
            audio_format=AudioFormat.WAV,
            destination=destination,
        )
    assert first.read_bytes() == second.read_bytes()


def test_the_offline_track_lasts_as_long_as_the_words_would():
    seconds = estimated_seconds(NARRATION, Language.RU)
    assert seconds == pytest.approx(len(NARRATION) / 15.0, abs=0.01)
    assert estimated_seconds(NARRATION, Language.RU, speed=1.5) < seconds


def test_the_offline_provider_refuses_what_it_cannot_do(tmp_path: Path):
    provider = OfflineVoiceProvider()
    with pytest.raises(ProviderError, match="does not offer the voice"):
        provider.synthesize(
            text=NARRATION,
            voice="marin",
            language=Language.RU,
            audio_format=AudioFormat.WAV,
            destination=tmp_path / "voice.wav",
        )
    with pytest.raises(ProviderError, match="cannot return"):
        provider.synthesize(
            text=NARRATION,
            voice=OFFLINE_VOICE_NAME,
            language=Language.RU,
            audio_format=AudioFormat.MP3,
            destination=tmp_path / "voice.mp3",
        )


def test_the_offline_provider_can_be_scripted_to_fail(tmp_path: Path):
    provider = OfflineVoiceProvider(failures=[transient_failure("outage")])
    with pytest.raises(TransientProviderError):
        provider.synthesize(
            text=NARRATION,
            voice=OFFLINE_VOICE_NAME,
            language=Language.RU,
            audio_format=AudioFormat.WAV,
            destination=tmp_path / "voice.wav",
        )


def test_the_offline_capabilities_mirror_the_real_limits():
    assert OFFLINE_VOICE_CAPABILITIES.max_input_chars == TTS_CAPABILITIES.max_input_chars
    assert OFFLINE_VOICE_CAPABILITIES.supported_languages == TTS_CAPABILITIES.supported_languages


def test_a_placeholder_needs_something_to_stand_in_for(tmp_path: Path):
    with pytest.raises(ValueError, match="narration"):
        render_placeholder_voice(tmp_path / "voice.wav", "   ", Language.RU)
