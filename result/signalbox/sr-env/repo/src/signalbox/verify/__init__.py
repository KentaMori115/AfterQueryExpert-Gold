"""Checking an interlocking against the rules it is supposed to obey.

Each rule is a small function that is handed everything already worked out about
a scheme and returns whatever it objects to. Rules never raise, never stop each
other running, and never look at anything they were not given, so a failing rule
is a bug in that rule and nothing else.
"""

from .report import Finding, Report, Severity
from .rules import Context, registered, rule, run

__all__ = ["Context", "Finding", "Report", "Severity", "registered", "rule", "run"]
