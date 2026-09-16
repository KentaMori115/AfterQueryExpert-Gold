"""Structured logging.

Two output modes are supported:

``json``
    One JSON object per line, for machine processing and run logs.
``console``
    Human-readable Rich output for interactive CLI usage.

Every handler passes through :class:`SecretRedactingFilter`, so an accidental
API key in a log record is masked before it reaches a file or the terminal.
"""

from __future__ import annotations

import json
import logging
import re
from collections.abc import Iterable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from rich.logging import RichHandler

LOGGER_NAME = "maingott_reel"

_REDACTED = "***REDACTED***"

#: Patterns that must never appear in a log line.
_SECRET_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"sk-[A-Za-z0-9_\-]{8,}"),
    re.compile(r"(?i)\b(api[_-]?key|authorization|bearer)\b\s*[:=]\s*\S+"),
)

_STANDARD_RECORD_FIELDS = frozenset(
    logging.LogRecord("", 0, "", 0, "", None, None).__dict__
) | frozenset({"message", "asctime", "taskName"})


def redact(text: str, extra_secrets: Iterable[str] = ()) -> str:
    """Mask secrets in ``text``."""
    result = text
    for secret in extra_secrets:
        if secret:
            result = result.replace(secret, _REDACTED)
    for pattern in _SECRET_PATTERNS:
        result = pattern.sub(_REDACTED, result)
    return result


class SecretRedactingFilter(logging.Filter):
    """Redact secrets from a record's message, arguments and structured fields.

    Structured fields matter as much as the message: a provider's error text
    is usually logged as ``extra={"error": ...}``, and that is exactly where a
    key would arrive if one ever leaked into a response.
    """

    def __init__(self, extra_secrets: Iterable[str] = ()) -> None:
        super().__init__()
        self._extra_secrets = tuple(s for s in extra_secrets if s)

    def filter(self, record: logging.LogRecord) -> bool:
        record.msg = redact(str(record.msg), self._extra_secrets)
        if record.args:
            if isinstance(record.args, dict):
                record.args = {
                    key: redact(str(value), self._extra_secrets)
                    for key, value in record.args.items()
                }
            else:
                record.args = tuple(
                    redact(str(value), self._extra_secrets) for value in record.args
                )
        for key, value in list(record.__dict__.items()):
            if key in _STANDARD_RECORD_FIELDS or key.startswith("_"):
                continue
            record.__dict__[key] = self._clean(value)
        return True

    def _clean(self, value: Any) -> Any:
        """Redact secrets anywhere inside a structured log value."""
        if isinstance(value, str):
            return redact(value, self._extra_secrets)
        if isinstance(value, dict):
            return {key: self._clean(item) for key, item in value.items()}
        if isinstance(value, list | tuple):
            return type(value)(self._clean(item) for item in value)
        return value


class JsonFormatter(logging.Formatter):
    """Render log records as single-line JSON objects."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.fromtimestamp(record.created, tz=UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        for key, value in record.__dict__.items():
            if key in _STANDARD_RECORD_FIELDS or key.startswith("_"):
                continue
            payload[key] = _jsonable(value)
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False, default=str)


def _jsonable(value: Any) -> Any:
    if isinstance(value, str | int | float | bool | type(None)):
        return value
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, dict | list | tuple):
        return json.loads(json.dumps(value, ensure_ascii=False, default=str))
    return str(value)


def configure_logging(
    level: str = "INFO",
    fmt: str = "console",
    log_file: Path | None = None,
    extra_secrets: Iterable[str] = (),
) -> logging.Logger:
    """Configure and return the application logger.

    Calling this repeatedly is safe: existing handlers are replaced.
    """
    logger = logging.getLogger(LOGGER_NAME)
    logger.setLevel(level.upper())
    logger.propagate = False
    for handler in list(logger.handlers):
        logger.removeHandler(handler)
        handler.close()

    redactor = SecretRedactingFilter(extra_secrets)

    stream_handler: logging.Handler
    if fmt == "json":
        stream_handler = logging.StreamHandler()
        stream_handler.setFormatter(JsonFormatter())
    else:
        stream_handler = RichHandler(rich_tracebacks=True, show_path=False, markup=False)
        stream_handler.setFormatter(logging.Formatter("%(message)s"))
    stream_handler.addFilter(redactor)
    logger.addHandler(stream_handler)

    if log_file is not None:
        log_file.parent.mkdir(parents=True, exist_ok=True)
        file_handler = logging.FileHandler(log_file, encoding="utf-8")
        file_handler.setFormatter(JsonFormatter())
        file_handler.addFilter(redactor)
        logger.addHandler(file_handler)

    return logger


def get_logger(name: str | None = None) -> logging.Logger:
    """Return a child logger of the application logger."""
    if name is None or name == LOGGER_NAME:
        return logging.getLogger(LOGGER_NAME)
    return logging.getLogger(f"{LOGGER_NAME}.{name}")
