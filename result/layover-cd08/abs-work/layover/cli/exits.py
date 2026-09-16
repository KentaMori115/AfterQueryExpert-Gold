"""What the command line returns to the shell.

A search that finds nothing is not a crash, but it is not a success either: a
script that plans a journey and gets nothing back should be able to notice
without reading the output.
"""

from __future__ import annotations

__all__ = ["FAILED", "NOTHING_FOUND", "OK", "USAGE", "describe_exit"]

OK = 0
FAILED = 1
USAGE = 2
NOTHING_FOUND = 3

_MEANINGS = {
    OK: "done",
    FAILED: "the feed could not be read or a check failed",
    USAGE: "the command line was used wrongly",
    NOTHING_FOUND: "nothing matched",
}


def describe_exit(code: int) -> str:
    """What an exit code means, in a few words."""
    return _MEANINGS.get(code, "unknown exit code %d" % code)
