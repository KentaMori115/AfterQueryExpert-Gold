"""Stub of the repository's exception hierarchy (base-commit behaviour)."""


class ConfigError(Exception):
    """Base error for every configlayer failure."""


class ExportError(ConfigError):
    """Raised when a configuration mapping cannot be rendered as text."""
