"""The fmt command: put a scheme plan into its canonical shape."""

from __future__ import annotations

from pathlib import Path

import typer

from ...errors import SignalboxError
from ...layout.format import format_scheme
from ...layout.loader import SUFFIX, load_text
from ..common import EXIT_FINDINGS, EXIT_OK, console, fail, raw


def _read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except OSError as exc:
        fail(f"cannot read {path}: {exc.strerror}")


def _formatted(path: Path, original: str) -> str:
    try:
        return format_scheme(load_text(original, source=str(path)))
    except SignalboxError as exc:
        fail(str(exc))


def _rewrite(path: Path, formatted: str) -> None:
    try:
        path.write_text(formatted, encoding="utf-8")
    except OSError as exc:
        fail(f"cannot write {path}: {exc.strerror}")


def fmt(
    plans: list[Path] = typer.Argument(..., help="the plans to format"),
    write: bool = typer.Option(False, "--write", "-w", help="rewrite the files in place"),
    check: bool = typer.Option(
        False, "--check", help="say which files would change and exit non zero"
    ),
) -> None:
    """Reformat scheme plans, or say which ones need it.

    Comments are not kept, which is why this only ever writes when told to.
    """
    targets = _expand(plans)
    if not targets:
        fail("nothing to format")

    changed: list[Path] = []
    for path in targets:
        original = _read(path)
        formatted = _formatted(path, original)
        if formatted == original:
            continue

        changed.append(path)
        if write:
            _rewrite(path, formatted)
        elif not check:
            raw(formatted)

    if check or write:
        done = "reformatted" if write else "would reformat"
        for path in changed:
            console.print(f"{done} {path}")
        console.print(f"{len(changed)} of {len(targets)} files")

    raise typer.Exit(EXIT_FINDINGS if check and changed else EXIT_OK)


def _expand(plans: list[Path]) -> list[Path]:
    found: list[Path] = []
    for path in plans:
        if path.is_dir():
            found.extend(sorted(path.glob(f"*{SUFFIX}")))
        else:
            found.append(path)
    return found


def register(app: typer.Typer) -> None:
    app.command()(fmt)
