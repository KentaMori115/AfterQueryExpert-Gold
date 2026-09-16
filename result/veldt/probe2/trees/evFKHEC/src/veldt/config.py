"""Engine configuration.

Everything tunable about a :class:`~veldt.engine.Engine` lives in one frozen
dataclass. Frozen because changing a setting mid-query would make the metrics
and the plan disagree with what actually ran; :meth:`EngineConfig.replace`
returns a new configuration instead.
"""

from __future__ import annotations

from dataclasses import dataclass, replace as dataclass_replace
from typing import Any, Dict, Mapping

from .core.table import DEFAULT_BATCH_SIZE
from .errors import ConfigurationError

__all__ = ["EngineConfig", "DEFAULT_CONFIG"]


@dataclass(frozen=True)
class EngineConfig:
    """Settings that govern planning and execution.

    Attributes:
        batch_size: Rows per batch flowing between operators. Smaller batches
            reduce peak memory; larger ones reduce per-batch overhead.
        optimize: Whether to run the optimizer at all. Turning it off is the
            fastest way to tell a wrong answer from a wrong rewrite.
        max_optimizer_iterations: How many times the rule set may be applied
            before the optimizer gives up on reaching a fixpoint.
        collect_metrics: Whether operators record counters and timings.
        enable_tracing: Whether execution records a span tree.
        cache_enabled: Whether materialised tables are cached between queries.
        cache_max_rows: Row budget for that cache.
        fail_on_unknown_column: Reserved for future relaxed name resolution;
            when false, unknown columns would resolve to null instead of
            raising. Only ``True`` is currently supported.
    """

    batch_size: int = DEFAULT_BATCH_SIZE
    optimize: bool = True
    max_optimizer_iterations: int = 8
    collect_metrics: bool = True
    enable_tracing: bool = False
    cache_enabled: bool = False
    cache_max_rows: int = 1_000_000
    fail_on_unknown_column: bool = True

    def __post_init__(self) -> None:
        self.validate()

    def validate(self) -> None:
        """Check the configuration for internally inconsistent settings.

        Raises:
            ConfigurationError: If any setting is out of range or unsupported.
        """
        if self.batch_size <= 0:
            raise ConfigurationError("batch_size must be positive")
        if self.max_optimizer_iterations < 1:
            raise ConfigurationError("max_optimizer_iterations must be at least 1")
        if self.cache_max_rows < 0:
            raise ConfigurationError("cache_max_rows must not be negative")
        if not self.fail_on_unknown_column:
            raise ConfigurationError(
                "relaxed column resolution is not implemented; "
                "fail_on_unknown_column must be True"
            )

    def replace(self, **changes: Any) -> "EngineConfig":
        """Return a copy with some settings changed.

        Raises:
            ConfigurationError: If a named setting does not exist.
        """
        unknown = set(changes) - set(self.to_dict())
        if unknown:
            raise ConfigurationError(
                f"unknown configuration setting(s): {', '.join(sorted(unknown))}"
            )
        return dataclass_replace(self, **changes)

    def to_dict(self) -> Dict[str, Any]:
        """Return the settings as a plain dictionary."""
        return {
            "batch_size": self.batch_size,
            "optimize": self.optimize,
            "max_optimizer_iterations": self.max_optimizer_iterations,
            "collect_metrics": self.collect_metrics,
            "enable_tracing": self.enable_tracing,
            "cache_enabled": self.cache_enabled,
            "cache_max_rows": self.cache_max_rows,
            "fail_on_unknown_column": self.fail_on_unknown_column,
        }

    @classmethod
    def from_dict(cls, payload: Mapping[str, Any]) -> "EngineConfig":
        """Build a configuration from a dictionary, ignoring nothing.

        Raises:
            ConfigurationError: If the payload contains unknown settings.
        """
        known = set(cls().to_dict())
        unknown = set(payload) - known
        if unknown:
            raise ConfigurationError(
                f"unknown configuration setting(s): {', '.join(sorted(unknown))}"
            )
        return cls(**dict(payload))

    def describe(self) -> str:
        """Render the settings one per line."""
        return "\n".join(f"{key} = {value}" for key, value in sorted(self.to_dict().items()))


DEFAULT_CONFIG = EngineConfig()
