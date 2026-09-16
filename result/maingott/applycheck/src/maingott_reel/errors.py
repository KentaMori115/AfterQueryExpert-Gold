"""Exception hierarchy shared by every pipeline stage."""

from __future__ import annotations


class MainGottError(Exception):
    """Base class for all application errors."""


class ConfigurationError(MainGottError):
    """Settings are missing or inconsistent."""


class SourceError(MainGottError):
    """The source specification is missing or unreadable."""


class RunNotFoundError(MainGottError):
    """A run directory was requested but does not exist."""


class StageNotCompletedError(MainGottError):
    """A stage requires an artifact that an earlier stage did not produce."""


class ProviderError(MainGottError):
    """A generation provider failed permanently."""


class TransientProviderError(ProviderError):
    """A provider failed in a way that is worth retrying."""


class ClaimNotSupportedError(MainGottError):
    """A creative statement is not backed by the source specification."""


class PlanRejectedError(MainGottError):
    """A generated creative plan failed deterministic validation."""


class CompositionError(MainGottError):
    """The Reel could not be composed from the approved inputs."""


class BudgetExceededError(MainGottError):
    """Generation would cost more than the configured budget allows."""


class ReleaseBlockedError(MainGottError):
    """The run is valid but must not be released as it stands."""


class ApprovalError(MainGottError):
    """An approval is missing, invalid, or describes different content."""


class ReleaseError(MainGottError):
    """A release package could not be built or no longer verifies."""


class ValidationFailedError(MainGottError):
    """The produced Reel did not satisfy the quality gates."""


class StageNotImplementedError(MainGottError):
    """The requested pipeline stage is not implemented yet."""

    def __init__(self, stage: str, phase: str) -> None:
        self.stage = stage
        self.phase = phase
        super().__init__(f"Stage '{stage}' is not implemented yet (planned for {phase}).")
