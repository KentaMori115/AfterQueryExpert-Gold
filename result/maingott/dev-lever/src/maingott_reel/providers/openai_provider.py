"""OpenAI adapter.

This is the only module that imports the OpenAI SDK. It implements the
provider protocols from :mod:`maingott_reel.providers.base`, so business logic
never sees an SDK type.

Verified against the official documentation and the installed SDK's generated
types (August 2026):

* structured output uses the Responses API — ``client.responses.parse(...)``
  with ``text_format=<pydantic model>``, read back from ``output_parsed``;
* schemas must have every field required and no defaults, which is why the
  wire schemas in :mod:`maingott_reel.creative.draft` are flat and permissive;
* current text model ids are ``gpt-5.6-sol`` / ``gpt-5.6-terra`` /
  ``gpt-5.6-luna``; reasoning effort is passed as ``reasoning={"effort": ...}``;
* refusals arrive as a ``refusal`` content item rather than as an exception.

* speech uses ``client.audio.speech.create(...)``, which returns binary audio
  content written with ``write_to_file``. Current model ids are
  ``gpt-4o-mini-tts`` (steerable, and the only family that accepts
  ``instructions``), ``tts-1`` and ``tts-1-hd``; ``input`` is capped at 4096
  characters; ``response_format`` is one of mp3, opus, aac, flac, wav or pcm;
  ``speed`` runs from 0.25 to 4.0. The published voice list and the SDK's
  generated ``Voice`` literal disagree on four names, so
  :data:`OPENAI_VOICES` is the union of the two and the mismatch is recorded
  in ``docs/development/OPEN_QUESTIONS.md``.

* video generation uses ``client.videos.create(...)`` → poll →
  ``client.videos.download_content(id, variant="video")``. The SDK's generated
  parameter types are the authority on what may be requested: ``seconds`` is
  one of 4, 8 or 12 and ``size`` one of 720x1280, 1280x720, 1024x1792 or
  1792x1024, with models ``sora-2`` and ``sora-2-pro``. The published guide
  quotes different numbers, so :data:`SORA_CAPABILITIES` mirrors the SDK and
  the mismatch is recorded in ``docs/development/OPEN_QUESTIONS.md``.

The client is created lazily so importing this module performs no network or
credential work.
"""

from __future__ import annotations

import time
from dataclasses import replace
from pathlib import Path
from typing import TYPE_CHECKING, Any

from openai import (
    APIConnectionError,
    APITimeoutError,
    AuthenticationError,
    BadRequestError,
    ConflictError,
    InternalServerError,
    LengthFinishReasonError,
    OpenAI,
    OpenAIError,
    PermissionDeniedError,
    RateLimitError,
)
from pydantic import BaseModel, ValidationError
from tenacity import (
    RetryCallState,
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from maingott_reel.config import Settings
from maingott_reel.errors import ConfigurationError, ProviderError, TransientProviderError
from maingott_reel.logging_config import get_logger, redact
from maingott_reel.models.base import AudioFormat, Language
from maingott_reel.providers.base import (
    MediaResult,
    TextResult,
    Usage,
    VideoCapabilities,
    VoiceCapabilities,
)

if TYPE_CHECKING:  # pragma: no cover - typing only
    from openai.types.responses import Response

logger = get_logger("providers.openai")

PROVIDER_NAME = "openai"

#: SDK errors that are worth retrying.
TRANSIENT_ERRORS = (
    RateLimitError,
    APIConnectionError,
    APITimeoutError,
    InternalServerError,
    ConflictError,
)


def _log_retry(state: RetryCallState) -> None:
    """Log a retry without leaking request contents."""
    logger.warning(
        "provider call failed, retrying",
        extra={
            "attempt": state.attempt_number,
            "error": type(state.outcome.exception()).__name__ if state.outcome else None,
        },
    )


class OpenAITextProvider:
    """Structured text generation through the OpenAI Responses API."""

    def __init__(self, settings: Settings, client: Any | None = None) -> None:
        """Store configuration. The SDK client is created on first use.

        Args:
            settings: effective configuration, including the API key.
            client: an already configured client, used by tests.

        Raises:
            ConfigurationError: no API key is configured.
        """
        self._settings = settings
        self._model = settings.openai_text_model
        self._client = client
        if client is None:
            # Fail before any work is queued rather than mid-pipeline.
            settings.require_api_key()

    @property
    def name(self) -> str:
        """Provider identifier recorded in artifacts."""
        return PROVIDER_NAME

    @property
    def model(self) -> str:
        """Model id used for text generation."""
        return self._model

    def _get_client(self) -> Any:
        """Return the SDK client, creating it on first use."""
        if self._client is None:
            self._client = OpenAI(
                api_key=self._settings.require_api_key(),
                timeout=self._settings.openai_timeout_seconds,
                max_retries=0,  # retries are handled here, with our own logging
            )
        return self._client

    def generate_structured(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        schema: type[BaseModel],
        temperature: float | None = None,
    ) -> TextResult:
        """Generate an instance of ``schema``.

        Raises:
            ProviderError: the model refused, returned nothing usable, or the
                request was rejected.
            TransientProviderError: the call kept failing after retries.
        """
        response = self._call_with_retries(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            schema=schema,
            temperature=temperature,
        )
        value = self._extract(response, schema)
        usage = self._usage(response)
        logger.info(
            "structured generation complete",
            extra={
                "model": self._model,
                "input_tokens": usage.input_tokens,
                "output_tokens": usage.output_tokens,
                "schema": schema.__name__,
            },
        )
        return TextResult(value=value, usage=usage)

    def _call_with_retries(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        schema: type[BaseModel],
        temperature: float | None,
    ) -> Response:
        """Call the Responses API, retrying transient failures."""
        parameters: dict[str, Any] = {
            "model": self._model,
            "input": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "text_format": schema,
        }
        effort = self._settings.openai_reasoning_effort
        if effort:
            parameters["reasoning"] = {"effort": effort}
        chosen_temperature = (
            temperature if temperature is not None else self._settings.openai_temperature
        )
        if chosen_temperature is not None:
            parameters["temperature"] = chosen_temperature

        @retry(
            retry=retry_if_exception_type(TRANSIENT_ERRORS),
            stop=stop_after_attempt(self._settings.openai_max_retries),
            wait=wait_exponential(multiplier=1, min=1, max=30),
            before_sleep=_log_retry,
            reraise=True,
        )
        def _call() -> Response:
            response: Response = self._get_client().responses.parse(**parameters)
            return response

        try:
            return _call()
        except (AuthenticationError, PermissionDeniedError) as error:
            raise ConfigurationError(
                "OpenAI rejected the credentials. Check OPENAI_API_KEY and model access."
            ) from error
        except BadRequestError as error:
            raise ProviderError(
                f"OpenAI rejected the request for model '{self._model}': {redact(str(error))}"
            ) from error
        except LengthFinishReasonError as error:
            raise ProviderError(
                "The model hit its output limit before completing the plan."
            ) from error
        except TRANSIENT_ERRORS as error:
            raise TransientProviderError(
                f"OpenAI is unavailable after {self._settings.openai_max_retries} attempts: "
                f"{redact(str(error))}"
            ) from error

    def _extract(self, response: Response, schema: type[BaseModel]) -> BaseModel:
        """Read the parsed object out of a response.

        Raises:
            ProviderError: the response is a refusal, incomplete or unparsed.
        """
        refusal = self._refusal(response)
        if refusal:
            raise ProviderError(f"The model refused the request: {refusal}")
        if response.status == "incomplete":
            reason = getattr(response.incomplete_details, "reason", "unknown")
            raise ProviderError(f"The model returned an incomplete response ({reason}).")

        parsed = getattr(response, "output_parsed", None)
        if parsed is None:
            raise ProviderError("The model returned no structured output.")
        if isinstance(parsed, schema):
            return parsed
        # Defensive: validate whatever came back against the expected schema.
        try:
            return schema.model_validate(parsed)
        except ValidationError as error:
            raise ProviderError(
                f"The model's output does not match {schema.__name__}: {redact(str(error))}"
            ) from error

    @staticmethod
    def _refusal(response: Response) -> str | None:
        """Return the refusal message, if the model refused."""
        for item in response.output or []:
            for content in getattr(item, "content", None) or []:
                if getattr(content, "type", None) == "refusal":
                    return str(getattr(content, "refusal", "")) or "no reason given"
        return None

    def _usage(self, response: Response) -> Usage:
        """Convert SDK usage metadata into our own type."""
        usage = getattr(response, "usage", None)
        return Usage(
            model=getattr(response, "model", self._model) or self._model,
            input_tokens=getattr(usage, "input_tokens", None),
            output_tokens=getattr(usage, "output_tokens", None),
        )


#: What the video API accepts, taken from the SDK's generated parameter types.
SORA_CAPABILITIES = VideoCapabilities(
    supported_seconds=(4, 8, 12),
    supported_sizes=((720, 1280), (1280, 720), (1024, 1792), (1792, 1024)),
    max_prompt_chars=2000,
    supports_audio=True,
)

#: Statuses the video job can report.
_TERMINAL_STATUSES = frozenset({"completed", "failed"})


class OpenAIVideoProvider:
    """Video generation through the OpenAI video API."""

    def __init__(self, settings: Settings, client: Any | None = None) -> None:
        """Store configuration. The SDK client is created on first use.

        Args:
            settings: effective configuration, including the API key.
            client: an already configured client, used by tests.

        Raises:
            ConfigurationError: no API key is configured.
        """
        self._settings = settings
        self._model = settings.openai_video_model
        self._client = client
        if client is None:
            settings.require_api_key()

    @property
    def name(self) -> str:
        """Provider identifier recorded in artifacts."""
        return PROVIDER_NAME

    @property
    def model(self) -> str:
        """Model id used for video generation."""
        return self._model

    @property
    def capabilities(self) -> VideoCapabilities:
        """What this provider will accept."""
        return SORA_CAPABILITIES

    def _get_client(self) -> Any:
        """Return the SDK client, creating it on first use."""
        if self._client is None:
            self._client = OpenAI(
                api_key=self._settings.require_api_key(),
                timeout=self._settings.video_request_timeout_seconds,
                max_retries=0,  # retries are handled here, with our own logging
            )
        return self._client

    def generate_video(
        self,
        *,
        prompt: str,
        seconds: int,
        width: int,
        height: int,
        destination: Path,
    ) -> MediaResult:
        """Generate one clip and download it to ``destination``.

        Raises:
            ProviderError: the request is unsupported, the job failed, or the
                download produced nothing usable.
            TransientProviderError: the API kept failing after retries.
        """
        capabilities = self.capabilities
        if not capabilities.supports(seconds, (width, height)):
            raise ProviderError(
                f"{self._model} cannot generate {seconds}s at {width}x{height}. "
                f"Supported: {capabilities.supported_seconds} seconds, "
                f"{['x'.join(map(str, size)) for size in capabilities.supported_sizes]}."
            )
        if len(prompt) > capabilities.max_prompt_chars:
            raise ProviderError(
                f"prompt is {len(prompt)} characters; {self._model} accepts at most "
                f"{capabilities.max_prompt_chars}"
            )

        job = self._create_job(prompt=prompt, seconds=seconds, width=width, height=height)
        job = self._await_completion(job)
        self._download(job.id, destination)

        logger.info(
            "video generated",
            extra={
                "model": self._model,
                "seconds": seconds,
                "size": f"{width}x{height}",
                "job_id": job.id,
                "bytes": destination.stat().st_size,
            },
        )
        return MediaResult(
            path=destination,
            usage=Usage(model=self._model, requests=1),
            duration_seconds=float(seconds),
            width=width,
            height=height,
            metadata={
                "job_id": job.id,
                "status": getattr(job, "status", None),
                "reported_seconds": getattr(job, "seconds", None),
                "reported_size": getattr(job, "size", None),
            },
        )

    def _create_job(self, *, prompt: str, seconds: int, width: int, height: int) -> Any:
        """Submit the generation job, retrying transient failures."""

        @retry(
            retry=retry_if_exception_type(TRANSIENT_ERRORS),
            stop=stop_after_attempt(self._settings.openai_max_retries),
            wait=wait_exponential(multiplier=2, min=2, max=60),
            before_sleep=_log_retry,
            reraise=True,
        )
        def _create() -> Any:
            return self._get_client().videos.create(
                model=self._model,
                prompt=prompt,
                seconds=str(seconds),
                size=f"{width}x{height}",
            )

        try:
            return _create()
        except (AuthenticationError, PermissionDeniedError) as error:
            raise ConfigurationError(
                "OpenAI rejected the credentials. Check OPENAI_API_KEY and model access."
            ) from error
        except BadRequestError as error:
            raise ProviderError(
                f"OpenAI rejected the video request for '{self._model}': {redact(str(error))}"
            ) from error
        except TRANSIENT_ERRORS as error:
            raise TransientProviderError(
                f"OpenAI is unavailable after {self._settings.openai_max_retries} attempts: "
                f"{redact(str(error))}"
            ) from error

    def _await_completion(self, job: Any) -> Any:
        """Poll until the job finishes, fails or runs out of time.

        Raises:
            ProviderError: the job failed or did not finish in time.
        """
        deadline = time.monotonic() + self._settings.video_generation_timeout_seconds
        interval = self._settings.video_poll_interval_seconds
        current = job
        while getattr(current, "status", None) not in _TERMINAL_STATUSES:
            if time.monotonic() > deadline:
                raise ProviderError(
                    f"video job {getattr(current, 'id', 'unknown')} did not finish within "
                    f"{self._settings.video_generation_timeout_seconds}s"
                )
            time.sleep(interval)
            try:
                current = self._get_client().videos.retrieve(current.id)
            except TRANSIENT_ERRORS as error:
                logger.warning("polling failed, retrying", extra={"error": type(error).__name__})
                continue
            logger.info(
                "video job progress",
                extra={
                    "job_id": getattr(current, "id", None),
                    "status": getattr(current, "status", None),
                    "progress": getattr(current, "progress", None),
                },
            )

        if getattr(current, "status", None) == "failed":
            detail = getattr(getattr(current, "error", None), "message", None) or "no reason given"
            raise ProviderError(f"the video model refused or failed the job: {redact(str(detail))}")
        return current

    def _download(self, job_id: str, destination: Path) -> None:
        """Download the finished clip, writing it only once it is complete.

        Raises:
            ProviderError: the download failed or produced an empty file.
        """
        destination.parent.mkdir(parents=True, exist_ok=True)
        partial = destination.with_suffix(destination.suffix + ".part")
        try:
            content = self._get_client().videos.download_content(job_id, variant="video")
            content.write_to_file(partial)
        except TRANSIENT_ERRORS as error:
            partial.unlink(missing_ok=True)
            raise TransientProviderError(
                f"downloading the clip failed: {redact(str(error))}"
            ) from error
        except OpenAIError as error:
            partial.unlink(missing_ok=True)
            raise ProviderError(f"downloading the clip failed: {redact(str(error))}") from error

        if not partial.is_file() or partial.stat().st_size == 0:
            partial.unlink(missing_ok=True)
            raise ProviderError("the provider returned an empty clip")
        partial.replace(destination)


#: Voices the speech endpoint offers. The guide documents thirteen; the SDK's
#: generated literal lists ten, and accepts any string besides. This is the
#: union, so a documented voice is never rejected locally.
OPENAI_VOICES = (
    "alloy",
    "ash",
    "ballad",
    "cedar",
    "coral",
    "echo",
    "fable",
    "marin",
    "nova",
    "onyx",
    "sage",
    "shimmer",
    "verse",
)

#: Models that accept ``instructions``. The older ``tts-1`` family does not.
STEERABLE_TTS_MODELS = ("gpt-4o-mini-tts",)

#: What the speech endpoint accepts, taken from the SDK's generated parameter
#: types and the published guide.
TTS_CAPABILITIES = VoiceCapabilities(
    supported_voices=OPENAI_VOICES,
    supported_formats=(
        AudioFormat.WAV,
        AudioFormat.FLAC,
        AudioFormat.MP3,
        AudioFormat.AAC,
        AudioFormat.OPUS,
        AudioFormat.PCM,
    ),
    # Speech follows Whisper's language coverage, which includes Russian.
    supported_languages=(Language.RU, Language.EN),
    max_input_chars=4096,
    supports_instructions=True,
    supports_speed=True,
    speed_range=(0.25, 4.0),
)


class OpenAIVoiceProvider:
    """Narration synthesis through the OpenAI speech API.

    The provider speaks the approved narration verbatim. ``instructions``
    steer *delivery* — pace, tone, warmth — and never the words.
    """

    def __init__(self, settings: Settings, client: Any | None = None) -> None:
        """Store configuration. The SDK client is created on first use.

        Args:
            settings: effective configuration, including the API key.
            client: an already configured client, used by tests.

        Raises:
            ConfigurationError: no API key is configured.
        """
        self._settings = settings
        self._model = settings.openai_tts_model
        self._client = client
        if client is None:
            settings.require_api_key()

    @property
    def name(self) -> str:
        """Provider identifier recorded in artifacts."""
        return PROVIDER_NAME

    @property
    def model(self) -> str:
        """Model id used for speech generation."""
        return self._model

    @property
    def capabilities(self) -> VoiceCapabilities:
        """What this provider will accept."""
        if self._model in STEERABLE_TTS_MODELS:
            return TTS_CAPABILITIES
        # tts-1 and tts-1-hd reject `instructions`; everything else is shared.
        return replace(TTS_CAPABILITIES, supports_instructions=False)

    def _get_client(self) -> Any:
        """Return the SDK client, creating it on first use."""
        if self._client is None:
            self._client = OpenAI(
                api_key=self._settings.require_api_key(),
                timeout=self._settings.voice_request_timeout_seconds,
                max_retries=0,  # retries are handled here, with our own logging
            )
        return self._client

    def synthesize(
        self,
        *,
        text: str,
        voice: str,
        language: Language,
        audio_format: AudioFormat,
        destination: Path,
        instructions: str | None = None,
        speed: float | None = None,
    ) -> MediaResult:
        """Speak ``text`` and write the audio to ``destination``.

        Raises:
            ProviderError: the request is unsupported or the API returned
                nothing usable.
            TransientProviderError: the API kept failing after retries.
        """
        capabilities = self.capabilities
        self._check_request(text, voice, language, audio_format, instructions, speed, capabilities)

        parameters: dict[str, Any] = {
            "model": self._model,
            "voice": voice,
            "input": text,
            "response_format": audio_format.value,
        }
        if instructions and capabilities.supports_instructions:
            parameters["instructions"] = instructions
        if speed is not None:
            parameters["speed"] = speed

        content = self._call_with_retries(parameters)
        self._write(content, destination)

        logger.info(
            "narration generated",
            extra={
                "model": self._model,
                "voice": voice,
                "language": language.value,
                "format": audio_format.value,
                "characters": len(text),
                "bytes": destination.stat().st_size,
            },
        )
        return MediaResult(
            path=destination,
            usage=Usage(model=self._model, input_tokens=None, output_tokens=None, requests=1),
            metadata={
                "voice": voice,
                "response_format": audio_format.value,
                "speed": speed,
                "instructions_applied": bool(instructions and capabilities.supports_instructions),
            },
        )

    def _check_request(
        self,
        text: str,
        voice: str,
        language: Language,
        audio_format: AudioFormat,
        instructions: str | None,
        speed: float | None,
        capabilities: VoiceCapabilities,
    ) -> None:
        """Refuse a request the API cannot serve, before paying for it.

        Raises:
            ProviderError: the request is outside the provider's capabilities.
        """
        if not text.strip():
            raise ProviderError("there is no narration to speak")
        if len(text) > capabilities.max_input_chars:
            raise ProviderError(
                f"the narration is {len(text)} characters; {self._model} accepts at most "
                f"{capabilities.max_input_chars}"
            )
        if not capabilities.supports_voice(voice):
            raise ProviderError(
                f"{self._model} does not offer the voice '{voice}'. "
                f"Available: {', '.join(capabilities.supported_voices)}."
            )
        if language not in capabilities.supported_languages:
            raise ProviderError(
                f"{self._model} is not configured for narration in "
                f"'{language.value}'. Change the plan language or the voice provider."
            )
        if audio_format not in capabilities.supported_formats:
            raise ProviderError(
                f"{self._model} cannot return {audio_format.value}. "
                f"Available: {', '.join(item.value for item in capabilities.supported_formats)}."
            )
        if speed is not None and not capabilities.supports_speed_value(speed):
            low, high = capabilities.speed_range
            raise ProviderError(
                f"{self._model} accepts speaking speeds between {low} and {high}, not {speed}"
            )
        if instructions and not capabilities.supports_instructions:
            logger.warning(
                "the configured model ignores voice direction",
                extra={"model": self._model},
            )

    def _call_with_retries(self, parameters: dict[str, Any]) -> Any:
        """Call the speech endpoint, retrying transient failures."""

        @retry(
            retry=retry_if_exception_type(TRANSIENT_ERRORS),
            stop=stop_after_attempt(self._settings.openai_max_retries),
            wait=wait_exponential(multiplier=1, min=1, max=30),
            before_sleep=_log_retry,
            reraise=True,
        )
        def _call() -> Any:
            return self._get_client().audio.speech.create(**parameters)

        try:
            return _call()
        except (AuthenticationError, PermissionDeniedError) as error:
            raise ConfigurationError(
                "OpenAI rejected the credentials. Check OPENAI_API_KEY and model access."
            ) from error
        except BadRequestError as error:
            raise ProviderError(
                f"OpenAI rejected the speech request for '{self._model}': {redact(str(error))}"
            ) from error
        except TRANSIENT_ERRORS as error:
            raise TransientProviderError(
                f"OpenAI is unavailable after {self._settings.openai_max_retries} attempts: "
                f"{redact(str(error))}"
            ) from error

    @staticmethod
    def _write(content: Any, destination: Path) -> None:
        """Write the returned audio, only moving it into place once complete.

        Raises:
            ProviderError: the response carried no usable audio.
        """
        destination.parent.mkdir(parents=True, exist_ok=True)
        partial = destination.with_name(f".{destination.stem}.part{destination.suffix}")
        try:
            content.write_to_file(partial)
        except OpenAIError as error:
            partial.unlink(missing_ok=True)
            raise ProviderError(f"writing the narration failed: {redact(str(error))}") from error
        except (OSError, AttributeError) as error:
            partial.unlink(missing_ok=True)
            raise ProviderError(
                f"the speech response carried no audio: {redact(str(error))}"
            ) from error

        if not partial.is_file() or partial.stat().st_size == 0:
            partial.unlink(missing_ok=True)
            raise ProviderError("the provider returned empty audio")
        partial.replace(destination)
