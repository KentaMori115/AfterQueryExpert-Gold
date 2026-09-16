"""The command line: ``python -m layover``.

Every subcommand reads a feed, a document or the demo, asks the session one
question and prints the answer in whichever rendering was asked for.
"""

from __future__ import annotations

from layover.cli.args import UsageError, build_parser, parse
from layover.cli.commands import open_session, run_command, when
from layover.cli.exits import FAILED, NOTHING_FOUND, OK, USAGE, describe_exit
from layover.cli.main import main

__all__ = [
    "FAILED",
    "NOTHING_FOUND",
    "OK",
    "USAGE",
    "UsageError",
    "build_parser",
    "describe_exit",
    "main",
    "open_session",
    "parse",
    "run_command",
    "when",
]
