"""Checks over a loaded feed, and the findings they make.

Nothing here refuses to work: a feed with warnings still plans journeys. The
checks exist to say what will surprise a passenger, or what the feed author
meant to write and did not.
"""

from __future__ import annotations

from layover.validate.checks import CHECKS, check_named, check_names, describe_checks, register
from layover.validate.finding import Finding, Severity
from layover.validate.run import Findings, validate

__all__ = [
    "CHECKS",
    "Finding",
    "Findings",
    "Severity",
    "check_named",
    "check_names",
    "describe_checks",
    "register",
    "validate",
]
