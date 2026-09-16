"""Secrets must never reach an artifact, a log or an error message.

These are regression tests: every one of them describes a way a key could
plausibly escape, and asserts that it does not.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

import pytest

from maingott_reel.config import Settings
from maingott_reel.logging_config import configure_logging, get_logger, redact
from maingott_reel.utils.run_context import RunContext

SECRET = "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789"


def _keyed(settings: Settings) -> Settings:
    return settings.model_copy(
        update={"openai_api_key": Settings(openai_api_key=SECRET).openai_api_key}
    )


def _all_text(root: Path) -> str:
    """Every readable byte under a directory, as text."""
    chunks: list[str] = []
    for path in sorted(root.rglob("*")):
        if path.is_file():
            chunks.append(path.read_bytes().decode("utf-8", errors="replace"))
    return "\n".join(chunks)


# --- configuration --------------------------------------------------------------


def test_settings_never_print_the_key(settings: Settings):
    keyed = _keyed(settings)
    assert SECRET not in repr(keyed)
    assert SECRET not in str(keyed)
    assert SECRET not in str(keyed.describe())
    assert keyed.describe()["openai_api_key_set"] is True


def test_the_key_is_only_available_deliberately(settings: Settings):
    keyed = _keyed(settings)
    assert keyed.require_api_key() == SECRET
    assert SECRET not in json.dumps(keyed.describe(), default=str)


def test_the_configuration_snapshot_carries_no_secret(settings: Settings):
    from maingott_reel.release.configuration import snapshot

    dumped = json.dumps(snapshot(_keyed(settings)).model_dump(mode="json"), default=str)
    assert SECRET not in dumped
    assert "api_key" not in dumped.lower()


# --- logging ----------------------------------------------------------------------


def test_a_key_in_a_log_message_is_masked(tmp_path: Path):
    log_file = tmp_path / "run.jsonl"
    configure_logging(level="INFO", fmt="json", log_file=log_file, extra_secrets=[SECRET])
    get_logger("test").info("calling with %s", SECRET)
    get_logger("test").error(f"failed for key {SECRET}")
    for handler in logging.getLogger("maingott_reel").handlers:
        handler.flush()

    written = log_file.read_text(encoding="utf-8")
    assert SECRET not in written
    assert "REDACTED" in written


def test_an_authorization_header_is_masked():
    assert SECRET not in redact(f"Authorization: Bearer {SECRET}")
    assert "REDACTED" in redact("api_key=abc123def456")
    assert SECRET not in redact(f"error for {SECRET}")


def test_structured_log_fields_are_masked(tmp_path: Path):
    log_file = tmp_path / "run.jsonl"
    configure_logging(level="INFO", fmt="json", log_file=log_file, extra_secrets=[SECRET])
    get_logger("test").info("provider call", extra={"detail": f"key {SECRET} rejected"})
    for handler in logging.getLogger("maingott_reel").handlers:
        handler.flush()

    assert SECRET not in log_file.read_text(encoding="utf-8")


# --- provider errors ----------------------------------------------------------------


def test_a_provider_error_never_repeats_the_key(tmp_path: Path):
    from openai import BadRequestError

    from maingott_reel.errors import ProviderError
    from maingott_reel.providers.openai_provider import OpenAIVoiceProvider

    request = type("Request", (), {"method": "POST", "url": "/v1/audio/speech"})()
    response = type("HTTPResponse", (), {"status_code": 400, "headers": {}, "request": request})()
    error = BadRequestError(
        f"Incorrect API key provided: {SECRET}. Authorization: Bearer {SECRET}",
        response=response,
        body=None,
    )

    class _Speech:
        def create(self, **kwargs: object) -> object:
            raise error

    client = type("Client", (), {"audio": type("Audio", (), {"speech": _Speech()})()})()
    provider = OpenAIVoiceProvider(_keyed(Settings()), client=client)

    from maingott_reel.models import AudioFormat, Language

    with pytest.raises(ProviderError) as raised:
        provider.synthesize(
            text="Клиенты приходят из разных каналов.",
            voice="marin",
            language=Language.RU,
            audio_format=AudioFormat.WAV,
            destination=tmp_path / "voice.wav",
        )
    assert SECRET not in str(raised.value)
    assert "REDACTED" in str(raised.value)


# --- run artifacts --------------------------------------------------------------------


def test_no_run_artifact_contains_the_key(
    settings: Settings, storyboarded_run: RunContext, monkeypatch: pytest.MonkeyPatch
):
    from maingott_reel.assets.manager import generate_assets
    from maingott_reel.audio.voice import generate_voice

    monkeypatch.setenv("OPENAI_API_KEY", SECRET)
    keyed = _keyed(settings)

    generate_assets(keyed, run_id=storyboarded_run.run_id, offline=True)
    generate_voice(keyed, run_id=storyboarded_run.run_id, offline=True)

    written = _all_text(storyboarded_run.root)
    assert SECRET not in written
    assert "sk-proj" not in written


def test_no_release_artifact_contains_the_key(
    production_settings: Settings, approved_run: RunContext
):
    from maingott_reel.release import approval as approval_store
    from maingott_reel.release import package as release_package
    from maingott_reel.release.inputs import fingerprint, load_inputs

    keyed = _keyed(production_settings)
    inputs = load_inputs(approved_run)
    identity = fingerprint(keyed, inputs)
    approval = approval_store.load_approval(approved_run)
    assert approval is not None
    package = release_package.build(keyed, inputs, identity, approval)

    assert SECRET not in _all_text(package.root)
    assert SECRET not in _all_text(approved_run.root)


def test_the_provider_request_log_contains_no_key(settings: Settings, storyboarded_run: RunContext):
    from maingott_reel.audio.voice import generate_voice

    generate_voice(_keyed(settings), run_id=storyboarded_run.run_id, offline=True)

    assert storyboarded_run.provider_log.is_file()
    assert SECRET not in storyboarded_run.provider_log.read_text(encoding="utf-8")


def test_the_repository_never_holds_a_committed_env_file():
    root = Path(__file__).resolve().parents[1]
    assert not (root / ".env").is_file() or ".env" in (root / ".gitignore").read_text(
        encoding="utf-8"
    )
    assert ".env" in (root / ".gitignore").read_text(encoding="utf-8")
    example = (root / ".env.example").read_text(encoding="utf-8")
    assert "OPENAI_API_KEY=\n" in example, "the example file must never carry a key"
