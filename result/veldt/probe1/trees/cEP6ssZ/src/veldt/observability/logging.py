"""Logging helpers.

The engine logs through the standard library and installs no handlers of its
own beyond a null handler, so an embedding application keeps full control.
:func:`configure_logging` exists for the CLI, which does want output.
"""

from __future__ import annotations

import logging
import sys
from typing import Optional, TextIO

__all__ = ["get_logger", "configure_logging", "LOGGER_NAME", "LOG_FORMAT"]

LOGGER_NAME = "veldt"
LOG_FORMAT = "%(levelname)s %(name)s: %(message)s"
VERBOSE_FORMAT = "%(asctime)s %(levelname)-7s %(name)s: %(message)s"

_root = logging.getLogger(LOGGER_NAME)
_root.addHandler(logging.NullHandler())


def get_logger(name: Optional[str] = None) -> logging.Logger:
    """Return a logger under the ``veldt`` namespace."""
    if not name:
        return _root
    if name.startswith(f"{LOGGER_NAME}."):
        return logging.getLogger(name)
    return logging.getLogger(f"{LOGGER_NAME}.{name}")


def configure_logging(
    level: int = logging.WARNING,
    stream: Optional[TextIO] = None,
    verbose: bool = False,
) -> logging.Logger:
    """Attach a stream handler to the engine's root logger.

    Calling this more than once replaces the previous handler rather than
    stacking a second one, so repeated CLI invocations in one process do not
    duplicate every line.
    """
    logger = _root
    for handler in list(logger.handlers):
        if not isinstance(handler, logging.NullHandler):
            logger.removeHandler(handler)
    handler = logging.StreamHandler(stream or sys.stderr)
    handler.setFormatter(logging.Formatter(VERBOSE_FORMAT if verbose else LOG_FORMAT))
    logger.addHandler(handler)
    logger.setLevel(level)
    logger.propagate = False
    return logger


def level_from_name(name: str) -> int:
    """Translate a level name such as ``"debug"`` into its numeric value.

    Raises:
        ValueError: If the name is not a known level.
    """
    resolved = logging.getLevelName(name.upper())
    if not isinstance(resolved, int):
        raise ValueError(f"unknown log level {name!r}")
    return resolved
