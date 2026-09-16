"""Shared plumbing for the commands: loading, failing, and printing.

Commands do not raise. They print something a person can act on and set an exit
status, because a stack trace in front of a signal engineer is not a useful
error message.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from pathlib import Path
from typing import NoReturn

import typer
from rich.console import Console
from rich.table import Table

from ..errors import LayoutError, SignalboxError
from ..layout.context import explain
from ..layout.loader import SUFFIX
from ..signalling.interlocking import Interlocking, build_interlocking
from ..topology.scheme import Scheme, scheme_from_path

#: Exit statuses, so that scripts can tell a bad plan from a failing scheme.
EXIT_OK = 0
EXIT_FINDINGS = 1
EXIT_BAD_INPUT = 2

#: Set either of these in the environment and the output comes out plain.
NO_COLOUR_VARIABLES = ("NO_COLOR", "SIGNALBOX_NO_COLOR")


def wants_colour(environ: Mapping[str, str] | None = None) -> bool:
    """Whether to use colour at all.

    The convention is that any value of NO_COLOR, even an empty one, means no
    colour. A terminal that is not a terminal gets none either, which is what
    makes piping the output somewhere produce something readable.
    """
    found = os.environ if environ is None else environ
    return not any(name in found for name in NO_COLOUR_VARIABLES)


def build_console(*, stderr: bool = False) -> Console:
    return Console(stderr=stderr, no_color=not wants_colour(), soft_wrap=False)


console = build_console()
errors = build_console(stderr=True)


def fail(message: str, status: int = EXIT_BAD_INPUT) -> NoReturn:
    """Print a message on stderr and stop.

    This never returns, which is worth saying in the signature: a command that
    calls it does not have to write a return afterwards to convince anybody,
    including the type checker.
    """
    errors.print(f"[red]error:[/red] {message}", highlight=False)
    raise typer.Exit(status)


def fail_with(exc: SignalboxError, status: int = EXIT_BAD_INPUT) -> NoReturn:
    """Print an error, with the line of the plan it is about if there is one."""
    if isinstance(exc, LayoutError):
        errors.print(f"[red]error:[/red] {exc}", highlight=False)
        shown = explain(exc)
        if shown != str(exc):
            errors.print(shown[len(str(exc)) :].rstrip(), highlight=False, markup=False)
        raise typer.Exit(status)
    fail(str(exc), status)


def load(path: Path) -> Scheme:
    """Load a scheme plan, turning any library error into a clean exit."""
    try:
        return scheme_from_path(str(path))
    except SignalboxError as exc:
        fail_with(exc)


def plans_in(path: Path) -> list[Path]:
    """The plans a path names: the file itself, or every plan in a directory."""
    if not path.is_dir():
        return [path]
    found = sorted(path.glob(f"*{SUFFIX}"))
    if not found:
        fail(f"no {SUFFIX} files in {path}")
    return found


def load_interlocking(path: Path) -> tuple[Scheme, Interlocking]:
    scheme = load(path)
    try:
        return scheme, build_interlocking(scheme)
    except SignalboxError as exc:
        fail(str(exc))


def grid(title: str, columns: list[str], rows: list[list[str]]) -> Table:
    """A rich table with the house style: no heavy lines, dim headings."""
    table = Table(title=title, header_style="bold", show_lines=False, pad_edge=False)
    for column in columns:
        table.add_column(column, overflow="fold")
    for row in rows:
        table.add_row(*row)
    return table


def raw(text: str) -> None:
    """Print text exactly as it is.

    Anything meant to be read back by another program has to go out unwrapped
    and unstyled, or a long line comes back in two pieces and whatever reads it
    is entitled to complain.
    """
    console.print(text, end="", highlight=False, markup=False, soft_wrap=True)
