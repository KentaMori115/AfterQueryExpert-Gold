"""The OpenAI adapter.

The SDK client is replaced by a stub, so these tests exercise the adapter's
own behaviour — parameters, error mapping, refusals and retries — without a
key and without network access.
"""

from __future__ import annotations

from typing import Any

import pytest
from openai import APIConnectionError, AuthenticationError, BadRequestError, RateLimitError
from pydantic import BaseModel

from maingott_reel.config import Settings
from maingott_reel.errors import ConfigurationError, ProviderError, TransientProviderError
from maingott_reel.providers.openai_provider import OpenAITextProvider


class Plan(BaseModel):
    headline: str


class _Content:
    def __init__(self, type_: str, refusal: str | None = None) -> None:
        self.type = type_
        self.refusal = refusal


class _Item:
    def __init__(self, content: list[_Content]) -> None:
        self.content = content


class _Usage:
    input_tokens = 120
    output_tokens = 340


class _Response:
    def __init__(
        self,
        parsed: Any = None,
        status: str = "completed",
        output: list[_Item] | None = None,
        incomplete_reason: str | None = None,
    ) -> None:
        self.output_parsed = parsed
        self.status = status
        self.output = output or []
        self.usage = _Usage()
        self.model = "gpt-5.6-terra"
        self.incomplete_details = type("Details", (), {"reason": incomplete_reason})()


class _Responses:
    def __init__(self, results: list[Any]) -> None:
        self._results = list(results)
        self.calls: list[dict[str, Any]] = []

    def parse(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        result = self._results.pop(0)
        if isinstance(result, Exception):
            raise result
        return result


class _Client:
    def __init__(self, results: list[Any]) -> None:
        self.responses = _Responses(results)


def _settings(**overrides: Any) -> Settings:
    return Settings(openai_api_key="sk-test-key", openai_max_retries=3, **overrides)


def _api_error(kind: type, message: str = "boom") -> Exception:
    request = type("Request", (), {"method": "POST", "url": "/v1/responses"})()
    response = type("HTTPResponse", (), {"status_code": 429, "headers": {}, "request": request})()
    if kind is APIConnectionError:
        return APIConnectionError(request=request)
    return kind(message, response=response, body=None)


def _provider(results: list[Any], **settings_overrides: Any) -> OpenAITextProvider:
    return OpenAITextProvider(_settings(**settings_overrides), client=_Client(results))


# --- construction --------------------------------------------------------


def test_a_missing_api_key_is_reported_before_any_call():
    with pytest.raises(ConfigurationError, match="OPENAI_API_KEY"):
        OpenAITextProvider(Settings())


def test_provider_identity_is_reported():
    provider = _provider([])
    assert provider.name == "openai"
    assert provider.model == "gpt-5.6-terra"


# --- successful calls ----------------------------------------------------


def test_structured_output_is_returned_with_usage():
    provider = _provider([_Response(parsed=Plan(headline="One connected system."))])
    result = provider.generate_structured(system_prompt="system", user_prompt="user", schema=Plan)
    assert isinstance(result.value, Plan)
    assert result.usage.input_tokens == 120
    assert result.usage.output_tokens == 340
    assert result.usage.model == "gpt-5.6-terra"


def test_the_request_uses_the_responses_api_contract():
    client = _Client([_Response(parsed=Plan(headline="ok"))])
    OpenAITextProvider(_settings(), client=client).generate_structured(
        system_prompt="system text", user_prompt="user text", schema=Plan
    )
    call = client.responses.calls[0]
    assert call["model"] == "gpt-5.6-terra"
    assert call["text_format"] is Plan
    assert call["input"] == [
        {"role": "system", "content": "system text"},
        {"role": "user", "content": "user text"},
    ]
    assert "temperature" not in call
    assert "reasoning" not in call


def test_reasoning_effort_is_passed_when_configured():
    client = _Client([_Response(parsed=Plan(headline="ok"))])
    OpenAITextProvider(
        _settings(openai_reasoning_effort="high"), client=client
    ).generate_structured(system_prompt="s", user_prompt="u", schema=Plan)
    assert client.responses.calls[0]["reasoning"] == {"effort": "high"}


def test_temperature_is_passed_only_when_requested():
    client = _Client([_Response(parsed=Plan(headline="ok"))])
    OpenAITextProvider(_settings(), client=client).generate_structured(
        system_prompt="s", user_prompt="u", schema=Plan, temperature=0.4
    )
    assert client.responses.calls[0]["temperature"] == 0.4


def test_an_unknown_reasoning_effort_is_rejected_by_configuration():
    with pytest.raises(ValueError, match="openai_reasoning_effort"):
        Settings(openai_reasoning_effort="turbo")


# --- failure modes -------------------------------------------------------


def test_a_refusal_is_reported():
    refusal = _Response(output=[_Item([_Content("refusal", "I cannot help with that")])])
    with pytest.raises(ProviderError, match="refused"):
        _provider([refusal]).generate_structured(system_prompt="s", user_prompt="u", schema=Plan)


def test_an_incomplete_response_is_reported():
    truncated = _Response(status="incomplete", incomplete_reason="max_output_tokens")
    with pytest.raises(ProviderError, match="incomplete"):
        _provider([truncated]).generate_structured(system_prompt="s", user_prompt="u", schema=Plan)


def test_a_missing_parse_result_is_reported():
    with pytest.raises(ProviderError, match="no structured output"):
        _provider([_Response(parsed=None)]).generate_structured(
            system_prompt="s", user_prompt="u", schema=Plan
        )


def test_output_that_does_not_match_the_schema_is_reported():
    with pytest.raises(ProviderError, match="does not match Plan"):
        _provider([_Response(parsed={"wrong": "shape"})]).generate_structured(
            system_prompt="s", user_prompt="u", schema=Plan
        )


def test_authentication_errors_become_configuration_errors():
    with pytest.raises(ConfigurationError, match="credentials"):
        _provider([_api_error(AuthenticationError)]).generate_structured(
            system_prompt="s", user_prompt="u", schema=Plan
        )


def test_bad_requests_are_reported_with_the_model_id():
    with pytest.raises(ProviderError, match=r"gpt-5\.6-terra"):
        _provider([_api_error(BadRequestError)]).generate_structured(
            system_prompt="s", user_prompt="u", schema=Plan
        )


def test_rate_limits_are_retried_and_then_succeed(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr("tenacity.nap.time.sleep", lambda _seconds: None)
    client = _Client([_api_error(RateLimitError), _Response(parsed=Plan(headline="ok"))])
    result = OpenAITextProvider(_settings(), client=client).generate_structured(
        system_prompt="s", user_prompt="u", schema=Plan
    )
    assert isinstance(result.value, Plan)
    assert len(client.responses.calls) == 2


def test_persistent_transient_failures_are_reported(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr("tenacity.nap.time.sleep", lambda _seconds: None)
    client = _Client([_api_error(RateLimitError) for _ in range(3)])
    with pytest.raises(TransientProviderError, match="unavailable"):
        OpenAITextProvider(_settings(), client=client).generate_structured(
            system_prompt="s", user_prompt="u", schema=Plan
        )
    assert len(client.responses.calls) == 3


def test_connection_errors_are_retried(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr("tenacity.nap.time.sleep", lambda _seconds: None)
    client = _Client([_api_error(APIConnectionError), _Response(parsed=Plan(headline="ok"))])
    OpenAITextProvider(_settings(), client=client).generate_structured(
        system_prompt="s", user_prompt="u", schema=Plan
    )
    assert len(client.responses.calls) == 2


def test_the_request_never_carries_the_api_key():
    client = _Client([_Response(parsed=Plan(headline="ok"))])
    OpenAITextProvider(_settings(), client=client).generate_structured(
        system_prompt="s", user_prompt="u", schema=Plan
    )
    assert "sk-test-key" not in repr(client.responses.calls[0])


def test_output_limits_are_reported():
    from openai import LengthFinishReasonError

    error = LengthFinishReasonError.__new__(LengthFinishReasonError)
    Exception.__init__(error, "length")
    with pytest.raises(ProviderError, match="output limit"):
        _provider([error]).generate_structured(system_prompt="s", user_prompt="u", schema=Plan)


def test_the_sdk_client_is_created_lazily_with_our_retry_policy(monkeypatch: pytest.MonkeyPatch):
    created: dict[str, Any] = {}

    class _StubClient:
        def __init__(self, **kwargs: Any) -> None:
            created.update(kwargs)
            self.responses = _Responses([_Response(parsed=Plan(headline="ok"))])

    monkeypatch.setattr("maingott_reel.providers.openai_provider.OpenAI", _StubClient)
    provider = OpenAITextProvider(_settings())
    assert not created, "no client is built before the first call"

    provider.generate_structured(system_prompt="s", user_prompt="u", schema=Plan)
    assert created["api_key"] == "sk-test-key"
    assert created["max_retries"] == 0
    assert created["timeout"] == 120.0
