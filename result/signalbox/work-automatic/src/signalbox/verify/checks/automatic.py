"""Signals the plan leaves to the trains, and whether it can.

An automatic signal is a promise that nothing about the move needs deciding. A
signal reading two ways has a decision in it, and so has one whose route calls a
set of points, because something has to move them and there is nobody there to
ask for it. Neither is a working arrangement, and neither is a signal the trains
can be left with: the plan says automatic and the ground says otherwise, which
is the one thing worth reporting about the flag.
"""

from __future__ import annotations

from collections.abc import Iterator

from ..report import Finding, Severity
from ..rules import Context, rule


@rule("auto-working", "automatic signals can be left to the trains", Severity.ERROR)
def automatic_signals_can_work(context: Context) -> Iterator[Finding]:
    for found in context.automatic.faults():
        yield Finding(
            rule="auto-working",
            severity=Severity.ERROR,
            subject=found.signal,
            message=f"is declared automatic and has {found.fault}",
            detail=found.detail,
        )
