"""The OpenAI video adapter.

Driven by a stub SDK client: no key, no network, no paid generation.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from openai import APIConnectionError, AuthenticationError, BadRequestError, RateLimitError

from maingott_reel.config import Settings
from maingott_reel.errors import ConfigurationError, ProviderError, TransientProviderError
from maingott_reel.providers.openai_provider import SORA_CAPABILITIES, OpenAIVideoProvider


class _Job:
    def __init__(self, status: str = "completed", error: object | None = None) -> None:
        self.id = "video_123"
        self.status = status
        self.error = error
        self.seconds = "4"
        self.size = "720x1280"
        self.progress = 100


class _Content:
    def __init__(self, payload: bytes = b"m" * 4096) -> None:
        self._payload = payload

    def write_to_file(self, path: Path) -> None:
        Path(path).write_bytes(self._payload)


class _Videos:
    def __init__(
        self,
        create_results: list[Any] | None = None,
        retrieve_results: list[Any] | None = None,
        content: Any = None,
    ) -> None:
        self._create = list(create_results or [_Job()])
        self._retrieve = list(retrieve_results or [])
        self._content = content if content is not None else _Content()
        self.create_calls: list[dict[str, Any]] = []
        self.download_calls: list[tuple[str, str]] = []

    def create(self, **kwargs: Any) -> Any:
        self.create_calls.append(kwargs)
        result = self._create.pop(0)
        if isinstance(result, Exception):
            raise result
        return result

    def retrieve(self, job_id: str) -> Any:
        result = self._retrieve.pop(0)
        if isinstance(result, Exception):
            raise result
        return result

    def download_content(self, job_id: str, variant: str = "video") -> Any:
        self.download_calls.append((job_id, variant))
        if isinstance(self._content, Exception):
            raise self._content
        return self._content


class _Client:
    def __init__(self, videos: _Videos) -> None:
        self.videos = videos


def _settings(**overrides: Any) -> Settings:
    defaults: dict[str, Any] = {
        "openai_api_key": "sk-test-key",
        "openai_max_retries": 3,
        "video_poll_interval_seconds": 0.001,
        "video_generation_timeout_seconds": 5,
    }
    defaults.update(overrides)
    return Settings(**defaults)


def _api_error(kind: type, message: str = "boom") -> Exception:
    request = type("Request", (), {"method": "POST", "url": "/v1/videos"})()
    response = type("HTTPResponse", (), {"status_code": 429, "headers": {}, "request": request})()
    if kind is APIConnectionError:
        return APIConnectionError(request=request)
    return kind(message, response=response, body=None)


def _provider(videos: _Videos, **settings_overrides: Any) -> OpenAIVideoProvider:
    return OpenAIVideoProvider(_settings(**settings_overrides), client=_Client(videos))


# --- capabilities ----------------------------------------------------------


def test_capabilities_match_the_sdk_contract():
    assert SORA_CAPABILITIES.supported_seconds == (4, 8, 12)
    assert (720, 1280) in SORA_CAPABILITIES.supported_sizes
    assert SORA_CAPABILITIES.best_portrait_size(1080, 1920) == (720, 1280)
    assert SORA_CAPABILITIES.seconds_for(3.8) == 4
    assert SORA_CAPABILITIES.seconds_for(8.6) == 12
    assert SORA_CAPABILITIES.seconds_for(20) is None


def test_provider_identity():
    provider = _provider(_Videos())
    assert provider.name == "openai"
    assert provider.model == "sora-2"
    assert provider.capabilities is SORA_CAPABILITIES


def test_a_missing_api_key_is_reported_before_any_call():
    with pytest.raises(ConfigurationError, match="OPENAI_API_KEY"):
        OpenAIVideoProvider(Settings())


# --- successful generation --------------------------------------------------


def test_a_clip_is_generated_and_downloaded(tmp_path: Path):
    videos = _Videos()
    destination = tmp_path / "scene_01" / "video.mp4"

    result = _provider(videos).generate_video(
        prompt="A dark room", seconds=4, width=720, height=1280, destination=destination
    )

    assert destination.is_file()
    assert result.path == destination
    assert result.duration_seconds == 4.0
    assert (result.width, result.height) == (720, 1280)
    assert result.metadata["job_id"] == "video_123"
    assert videos.create_calls[0] == {
        "model": "sora-2",
        "prompt": "A dark room",
        "seconds": "4",
        "size": "720x1280",
    }
    assert videos.download_calls == [("video_123", "video")]


def test_a_queued_job_is_polled_until_it_finishes(tmp_path: Path):
    videos = _Videos(
        create_results=[_Job(status="queued")],
        retrieve_results=[_Job(status="in_progress"), _Job(status="completed")],
    )
    _provider(videos).generate_video(
        prompt="A dark room", seconds=4, width=720, height=1280, destination=tmp_path / "v.mp4"
    )
    assert (tmp_path / "v.mp4").is_file()


def test_no_partial_file_is_left_behind(tmp_path: Path):
    _provider(_Videos()).generate_video(
        prompt="A dark room", seconds=4, width=720, height=1280, destination=tmp_path / "v.mp4"
    )
    assert list(tmp_path.glob("*.part")) == []


# --- refused requests -------------------------------------------------------


@pytest.mark.parametrize(
    ("seconds", "width", "height"),
    [(5, 720, 1280), (4, 1080, 1920), (16, 720, 1280)],
)
def test_unsupported_requests_never_reach_the_api(
    tmp_path: Path, seconds: int, width: int, height: int
):
    videos = _Videos()
    with pytest.raises(ProviderError, match="cannot generate"):
        _provider(videos).generate_video(
            prompt="A dark room",
            seconds=seconds,
            width=width,
            height=height,
            destination=tmp_path / "v.mp4",
        )
    assert videos.create_calls == [], "an unsupported request must not be paid for"


def test_an_over_long_prompt_never_reaches_the_api(tmp_path: Path):
    videos = _Videos()
    with pytest.raises(ProviderError, match="characters"):
        _provider(videos).generate_video(
            prompt="x" * 5000, seconds=4, width=720, height=1280, destination=tmp_path / "v.mp4"
        )
    assert videos.create_calls == []


# --- failures ----------------------------------------------------------------


def test_a_failed_job_is_reported(tmp_path: Path):
    error = type("Error", (), {"message": "content policy"})()
    videos = _Videos(create_results=[_Job(status="failed", error=error)])
    with pytest.raises(ProviderError, match="content policy"):
        _provider(videos).generate_video(
            prompt="A dark room", seconds=4, width=720, height=1280, destination=tmp_path / "v.mp4"
        )


def test_a_job_that_never_finishes_times_out(tmp_path: Path):
    videos = _Videos(
        create_results=[_Job(status="queued")],
        retrieve_results=[_Job(status="in_progress") for _ in range(50)],
    )
    with pytest.raises(ProviderError, match="did not finish"):
        _provider(videos, video_generation_timeout_seconds=0.01).generate_video(
            prompt="A dark room", seconds=4, width=720, height=1280, destination=tmp_path / "v.mp4"
        )


def test_authentication_errors_become_configuration_errors(tmp_path: Path):
    videos = _Videos(create_results=[_api_error(AuthenticationError)])
    with pytest.raises(ConfigurationError, match="credentials"):
        _provider(videos).generate_video(
            prompt="A dark room", seconds=4, width=720, height=1280, destination=tmp_path / "v.mp4"
        )


def test_bad_requests_are_not_retried(tmp_path: Path):
    videos = _Videos(create_results=[_api_error(BadRequestError, "unsupported size")])
    with pytest.raises(ProviderError, match="rejected the video request"):
        _provider(videos).generate_video(
            prompt="A dark room", seconds=4, width=720, height=1280, destination=tmp_path / "v.mp4"
        )
    assert len(videos.create_calls) == 1


def test_rate_limits_are_retried(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr("tenacity.nap.time.sleep", lambda _seconds: None)
    videos = _Videos(create_results=[_api_error(RateLimitError), _Job()])

    _provider(videos).generate_video(
        prompt="A dark room", seconds=4, width=720, height=1280, destination=tmp_path / "v.mp4"
    )
    assert len(videos.create_calls) == 2


def test_persistent_transient_failures_are_reported(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr("tenacity.nap.time.sleep", lambda _seconds: None)
    videos = _Videos(create_results=[_api_error(APIConnectionError) for _ in range(3)])

    with pytest.raises(TransientProviderError, match="unavailable"):
        _provider(videos).generate_video(
            prompt="A dark room", seconds=4, width=720, height=1280, destination=tmp_path / "v.mp4"
        )
    assert len(videos.create_calls) == 3


def test_an_empty_download_is_rejected(tmp_path: Path):
    videos = _Videos(content=_Content(b""))
    destination = tmp_path / "v.mp4"

    with pytest.raises(ProviderError, match="empty clip"):
        _provider(videos).generate_video(
            prompt="A dark room", seconds=4, width=720, height=1280, destination=destination
        )
    assert not destination.exists()
    assert list(tmp_path.glob("*.part")) == []


def test_a_failing_download_is_reported(tmp_path: Path):
    videos = _Videos(content=_api_error(APIConnectionError))
    with pytest.raises(TransientProviderError, match="downloading"):
        _provider(videos).generate_video(
            prompt="A dark room", seconds=4, width=720, height=1280, destination=tmp_path / "v.mp4"
        )


def test_the_api_key_never_appears_in_the_request(tmp_path: Path):
    videos = _Videos()
    _provider(videos).generate_video(
        prompt="A dark room", seconds=4, width=720, height=1280, destination=tmp_path / "v.mp4"
    )
    assert "sk-test-key" not in repr(videos.create_calls)


def test_the_sdk_client_is_created_lazily(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    created: dict[str, Any] = {}

    class _StubClient:
        def __init__(self, **kwargs: Any) -> None:
            created.update(kwargs)
            self.videos = _Videos()

    monkeypatch.setattr("maingott_reel.providers.openai_provider.OpenAI", _StubClient)
    provider = OpenAIVideoProvider(_settings())
    assert not created, "no client is built before the first call"

    provider.generate_video(
        prompt="A dark room", seconds=4, width=720, height=1280, destination=tmp_path / "v.mp4"
    )
    assert created["api_key"] == "sk-test-key"
    assert created["max_retries"] == 0


def test_polling_survives_a_transient_error(tmp_path: Path):
    videos = _Videos(
        create_results=[_Job(status="queued")],
        retrieve_results=[_api_error(APIConnectionError), _Job(status="completed")],
    )
    _provider(videos).generate_video(
        prompt="A dark room", seconds=4, width=720, height=1280, destination=tmp_path / "v.mp4"
    )
    assert (tmp_path / "v.mp4").is_file()


def test_a_permanent_download_error_is_reported(tmp_path: Path):
    from openai import OpenAIError

    videos = _Videos(content=OpenAIError("the clip has expired"))
    destination = tmp_path / "v.mp4"

    with pytest.raises(ProviderError, match="expired"):
        _provider(videos).generate_video(
            prompt="A dark room", seconds=4, width=720, height=1280, destination=destination
        )
    assert not destination.exists()
    assert list(tmp_path.glob("*.part")) == []


def test_capabilities_report_their_longest_clip():
    assert SORA_CAPABILITIES.max_seconds == 12
    assert SORA_CAPABILITIES.supports(8, (720, 1280))
    assert not SORA_CAPABILITIES.supports(8, (1080, 1920))
