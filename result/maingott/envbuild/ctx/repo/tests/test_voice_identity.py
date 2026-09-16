"""Voice identity and cache keys."""

from __future__ import annotations

import pytest

from maingott_reel.audio.identity import VoiceRequest
from maingott_reel.models import AudioFormat, Language
from maingott_reel.utils.hashing import sha256_text

NARRATION = "Клиенты приходят из разных каналов.\nMainGott соединяет их в одну платформу."


def _request(**overrides: object) -> VoiceRequest:
    fields: dict[str, object] = {
        "narration": NARRATION,
        "provider": "openai",
        "model": "gpt-4o-mini-tts",
        "voice": "marin",
        "language": Language.RU,
        "audio_format": AudioFormat.WAV,
        "storyboard_sha256": "b" * 64,
        "source_sha256": "a" * 64,
        "target_duration_seconds": 40.0,
        "instructions": "Calm and confident.",
    }
    fields.update(overrides)
    return VoiceRequest(**fields)  # type: ignore[arg-type]


def test_the_narration_is_hashed_exactly_as_the_plan_holds_it():
    request = _request()
    assert request.narration_sha256 == sha256_text(NARRATION)
    assert request.spoken_text == NARRATION


def test_the_same_request_is_the_same_identity():
    assert _request().cache_key == _request().cache_key
    assert _request().voice_id == _request().voice_id


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("provider", "elevenlabs"),
        ("model", "tts-1-hd"),
        ("voice", "cedar"),
        ("language", Language.EN),
        ("audio_format", AudioFormat.MP3),
        ("speed", 1.1),
        ("instructions", "Read it like a movie trailer."),
    ],
)
def test_any_change_to_the_request_invalidates_the_cache(field: str, value: object):
    assert _request().cache_key != _request(**{field: value}).cache_key


def test_a_substantive_narration_change_invalidates_the_cache():
    changed = _request(narration=NARRATION + " Ещё одно предложение.")
    assert changed.cache_key != _request().cache_key
    assert changed.narration_sha256 != _request().narration_sha256


def test_a_whitespace_only_change_keeps_the_cache_key():
    respaced = _request(narration=NARRATION.replace("\n", "  \n  "))
    assert respaced.cache_key == _request().cache_key
    # ...but the binding hash still describes the exact approved text.
    assert respaced.narration_sha256 != _request().narration_sha256


def test_the_identity_is_scoped_to_the_run_but_the_cache_key_is_not():
    other_storyboard = _request(storyboard_sha256="c" * 64)
    assert other_storyboard.cache_key == _request().cache_key
    assert other_storyboard.voice_id != _request().voice_id

    other_source = _request(source_sha256="d" * 64)
    assert other_source.voice_id != _request().voice_id


def test_the_identity_is_not_a_timestamp():
    voice_id = _request().voice_id
    assert voice_id.startswith("voice-")
    assert len(voice_id) == len("voice-") + 12
    assert voice_id == _request().voice_id


def test_the_timeline_does_not_define_the_audio():
    # A different Reel length does not change what was said, so it must not
    # cost another generation.
    assert _request(target_duration_seconds=45.0).cache_key == _request().cache_key


def test_a_speed_change_produces_a_new_request():
    faster = _request().with_speed(1.15)
    assert faster.speed == 1.15
    assert faster.narration == _request().narration
    assert faster.cache_key != _request().cache_key


def test_counts_describe_the_narration():
    request = _request()
    assert request.characters == len(NARRATION)
    assert request.words == len(NARRATION.split())


def test_the_description_never_carries_the_words():
    described = _request().describe()
    assert NARRATION not in str(described)
    assert described["narration_sha256"] == sha256_text(NARRATION)
    assert described["characters"] == len(NARRATION)


def test_instructions_are_hashed_when_present():
    assert _request().instructions_sha256 == sha256_text("Calm and confident.")
    assert _request(instructions=None).instructions_sha256 is None
