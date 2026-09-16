"""Session level configuration.

A :class:`SessionConfig` is an immutable bundle of tuning knobs.  Every value
has a conservative default so that ``SessionConfig()`` is always valid; the
:meth:`SessionConfig.replace` helper produces modified copies without mutating
a config that other components may already hold a reference to.
"""

from __future__ import annotations

from dataclasses import dataclass, fields, replace
from typing import Any, Mapping

from .errors import ConfigurationError

__all__ = ["SessionConfig", "DEFAULT_CONFIG"]

_TRUE_WORDS = frozenset({"1", "true", "yes", "on"})
_FALSE_WORDS = frozenset({"0", "false", "no", "off"})


@dataclass(frozen=True)
class SessionConfig:
    """Tuning knobs that influence planning and execution.

    Attributes
    ----------
    batch_size:
        Maximum number of rows an operator emits in a single record batch.
    optimize:
        When ``False`` the optimizer pipeline is skipped entirely, which is
        useful when comparing optimized and unoptimized plans.
    max_rows:
        Hard ceiling on the number of rows a query may materialise.  ``0``
        disables the limit.
    null_ordering:
        Either ``"nulls_first"`` or ``"nulls_last"``; used when an ORDER BY
        item does not spell out its own null placement.
    case_sensitive_identifiers:
        When ``False`` (the default) unquoted identifiers fold to lower case.
    strict_casts:
        When ``True`` a failed CAST raises instead of producing NULL.
    collect_statistics:
        Whether the planner may consult per-table statistics for cost
        estimates.  Disabling it makes plans deterministic across data sets.
    explain_costs:
        Whether EXPLAIN output includes estimated cardinalities.
    """

    batch_size: int = 1024
    optimize: bool = True
    max_rows: int = 0
    null_ordering: str = "nulls_last"
    case_sensitive_identifiers: bool = False
    strict_casts: bool = False
    collect_statistics: bool = True
    explain_costs: bool = False

    def __post_init__(self) -> None:
        if self.batch_size <= 0:
            raise ConfigurationError("batch_size must be a positive integer")
        if self.max_rows < 0:
            raise ConfigurationError("max_rows must not be negative")
        if self.null_ordering not in ("nulls_first", "nulls_last"):
            raise ConfigurationError(
                "null_ordering must be 'nulls_first' or 'nulls_last', "
                f"got {self.null_ordering!r}"
            )

    @property
    def nulls_first_default(self) -> bool:
        """Return the default null placement as a boolean."""

        return self.null_ordering == "nulls_first"

    def replace(self, **overrides: Any) -> "SessionConfig":
        """Return a copy with ``overrides`` applied, validating the result."""

        known = {f.name for f in fields(self)}
        unknown = sorted(set(overrides) - known)
        if unknown:
            raise ConfigurationError(
                "unknown configuration option(s): " + ", ".join(unknown)
            )
        return replace(self, **overrides)

    def as_dict(self) -> dict[str, Any]:
        """Return the configuration as a plain dictionary."""

        return {f.name: getattr(self, f.name) for f in fields(self)}

    @classmethod
    def from_mapping(cls, values: Mapping[str, Any]) -> "SessionConfig":
        """Build a config from string-ish values, e.g. CLI ``--set`` flags."""

        typed: dict[str, Any] = {}
        by_name = {f.name: f for f in fields(cls)}
        for key, raw in values.items():
            field = by_name.get(key)
            if field is None:
                raise ConfigurationError(f"unknown configuration option: {key!r}")
            typed[key] = _coerce_option(key, field.type, raw)
        return cls(**typed)


def _coerce_option(name: str, annotation: Any, raw: Any) -> Any:
    """Coerce ``raw`` to the type named by ``annotation``."""

    text = annotation if isinstance(annotation, str) else getattr(annotation, "__name__", "")
    if text == "bool":
        if isinstance(raw, bool):
            return raw
        lowered = str(raw).strip().lower()
        if lowered in _TRUE_WORDS:
            return True
        if lowered in _FALSE_WORDS:
            return False
        raise ConfigurationError(f"option {name!r} expects a boolean, got {raw!r}")
    if text == "int":
        try:
            return int(str(raw).strip())
        except ValueError as exc:  # pragma: no cover - message tested instead
            raise ConfigurationError(
                f"option {name!r} expects an integer, got {raw!r}"
            ) from exc
    return str(raw)


DEFAULT_CONFIG = SessionConfig()
