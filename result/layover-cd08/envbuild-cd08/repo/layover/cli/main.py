"""The entry point: read the arguments, run the command, print the answer."""

from __future__ import annotations

import sys
from typing import Optional, Sequence, TextIO

from layover.cli.args import UsageError, parse
from layover.cli.commands import run_command
from layover.cli.exits import FAILED, OK, USAGE
from layover.errors import LayoverError, describe

__all__ = ["main"]


def main(argv: Optional[Sequence[str]] = None, out: Optional[TextIO] = None) -> int:
    """Run the command line and return the code the shell should see."""
    stream = out if out is not None else sys.stdout
    try:
        arguments = parse(argv)
    except UsageError as problem:
        print("layover: %s" % problem.message, file=stream)
        return USAGE
    except SystemExit as stop:
        return int(stop.code or OK)
    try:
        code, text = run_command(arguments)
    except UsageError as problem:
        print("layover: %s" % problem.message, file=stream)
        return USAGE
    except LayoverError as problem:
        print("layover: %s" % describe(problem), file=stream)
        return FAILED
    if text:
        print(text, file=stream)
    return code
