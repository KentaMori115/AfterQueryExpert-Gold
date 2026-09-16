"""The signalbox command.

    signalbox check kingsmoor.sbx
    signalbox routes kingsmoor.sbx
    signalbox table kingsmoor.sbx --format csv
    signalbox diff old.sbx new.sbx
    signalbox show kingsmoor.sbx --detail
    signalbox sim kingsmoor.sbx down-through-the-junction.sbs --log

Commands live one to a module under ``cli.commands``. This file exists only to
build the application and hand it to each of them.
"""

from __future__ import annotations

import os

import typer

from .. import __version__
from . import common
from .commands import (
    aspects,
    automatic,
    chainage,
    check,
    diff,
    distance,
    draw,
    export,
    fmt,
    graph,
    headway,
    locking,
    pack,
    panel,
    points,
    report,
    route,
    routes,
    rules,
    setting,
    show,
    sim,
    table,
    where,
)
from .common import EXIT_OK

#: Printed under the command list, because the three file types are the first
#: thing anybody has to know.
EPILOG = (
    "Files: .sbx is a scheme plan, .sbs is a scenario, "
    ".sbj is the interchange file that gets handed over."
)

app = typer.Typer(
    add_completion=False,
    no_args_is_help=True,
    help="Interlocking design and verification for railway signalling schemes.",
    epilog=EPILOG,
)


def _no_colour(chosen: bool) -> None:
    if chosen:
        os.environ["SIGNALBOX_NO_COLOR"] = "1"
        common.console = common.build_console()
        common.errors = common.build_console(stderr=True)


def _version(shown: bool) -> None:
    if shown:
        common.console.print(f"signalbox {__version__}")
        raise typer.Exit(EXIT_OK)


@app.callback()
def main(
    show_version: bool = typer.Option(
        False,
        "--version",
        "-V",
        help="print the version and stop",
        callback=_version,
        is_eager=True,
    ),
    no_colour: bool = typer.Option(
        False,
        "--no-colour",
        "--no-color",
        help="print without colour, as NO_COLOR in the environment does",
        callback=_no_colour,
        is_eager=True,
    ),
) -> None:
    """Interlocking design and verification for railway signalling schemes."""
    del show_version, no_colour


@app.command()
def version() -> None:
    """Print the version and stop."""
    common.console.print(f"signalbox {__version__}")


for module in (
    check,
    routes,
    table,
    points,
    diff,
    show,
    sim,
    draw,
    export,
    aspects,
    headway,
    fmt,
    chainage,
    locking,
    pack,
    graph,
    report,
    where,
    panel,
    distance,
    rules,
    route,
    setting,
    automatic,
):
    module.register(app)
