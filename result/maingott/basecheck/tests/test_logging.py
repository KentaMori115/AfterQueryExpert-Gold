"""Structured logging and secret redaction."""

from __future__ import annotations

import json
import logging
from pathlib import Path

from maingott_reel.logging_config import (
    JsonFormatter,
    SecretRedactingFilter,
    configure_logging,
    get_logger,
    redact,
)


def _record(message: str, **extra: object) -> logging.LogRecord:
    record = logging.LogRecord(
        name="maingott_reel.test",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg=message,
        args=(),
        exc_info=None,
    )
    for key, value in extra.items():
        setattr(record, key, value)
    return record


def test_json_formatter_emits_expected_fields():
    payload = json.loads(JsonFormatter().format(_record("hello")))
    assert payload["message"] == "hello"
    assert payload["level"] == "INFO"
    assert payload["logger"] == "maingott_reel.test"
    assert "timestamp" in payload


def test_json_formatter_includes_structured_extras():
    payload = json.loads(JsonFormatter().format(_record("stage done", stage="analyze", scenes=8)))
    assert payload["stage"] == "analyze"
    assert payload["scenes"] == 8


def test_json_formatter_serialises_paths():
    payload = json.loads(JsonFormatter().format(_record("wrote", artifact=Path("/tmp/a.json"))))
    assert payload["artifact"] == "/tmp/a.json"


def test_redact_masks_openai_style_keys():
    assert "sk-abcdef1234567890" not in redact("using key sk-abcdef1234567890 now")


def test_redact_masks_configured_secrets():
    assert "hunter2" not in redact("token hunter2", extra_secrets=["hunter2"])


def test_filter_redacts_message_and_args():
    record = _record("key=%s")
    record.args = ("sk-abcdef1234567890",)
    assert SecretRedactingFilter(["hunter2"]).filter(record) is True
    assert "sk-abcdef1234567890" not in record.getMessage()


def test_configure_logging_writes_json_lines_to_file(tmp_path: Path):
    log_file = tmp_path / "logs" / "run.jsonl"
    logger = configure_logging(
        level="INFO", fmt="json", log_file=log_file, extra_secrets=["s3cr3t"]
    )
    logger.info("stage finished", extra={"stage": "analyze"})
    for handler in logger.handlers:
        handler.flush()

    lines = log_file.read_text(encoding="utf-8").strip().splitlines()
    payload = json.loads(lines[-1])
    assert payload["message"] == "stage finished"
    assert payload["stage"] == "analyze"


def test_configure_logging_is_idempotent():
    first = configure_logging(fmt="json")
    handler_count = len(first.handlers)
    second = configure_logging(fmt="json")
    assert second is first
    assert len(second.handlers) == handler_count


def test_secrets_never_reach_the_log_file(tmp_path: Path):
    log_file = tmp_path / "run.jsonl"
    logger = configure_logging(
        level="INFO", fmt="json", log_file=log_file, extra_secrets=["s3cr3t"]
    )
    logger.info("calling provider with s3cr3t")
    for handler in logger.handlers:
        handler.flush()
    assert "s3cr3t" not in log_file.read_text(encoding="utf-8")


def test_get_logger_returns_namespaced_child():
    assert get_logger("cli").name == "maingott_reel.cli"
    assert get_logger().name == "maingott_reel"


def test_filter_redacts_dict_style_args():
    record = _record("%(key)s")
    record.args = {"key": "sk-abcdef1234567890"}
    SecretRedactingFilter().filter(record)
    assert isinstance(record.args, dict)
    assert record.args["key"] == "***REDACTED***"


def test_json_formatter_handles_nested_and_exotic_extras():
    payload = json.loads(
        JsonFormatter().format(_record("done", counts={"scenes": 8}, marker=object(), items=[1, 2]))
    )
    assert payload["counts"] == {"scenes": 8}
    assert payload["items"] == [1, 2]
    assert isinstance(payload["marker"], str)


def test_json_formatter_includes_exception_details():
    try:
        raise ValueError("boom")
    except ValueError:
        import sys

        record = _record("failed")
        record.exc_info = sys.exc_info()
    payload = json.loads(JsonFormatter().format(record))
    assert "ValueError: boom" in payload["exception"]


def test_console_format_is_supported():
    logger = configure_logging(level="DEBUG", fmt="console")
    assert logger.level == logging.DEBUG
    assert logger.handlers
