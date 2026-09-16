"""The half dozen things somebody using this as a library actually wants.

Everything here is a thin wrapper over something in a subpackage, and every one
of them exists because reaching four levels down to find it was the first thing
anybody had to work out. The subpackages are still there and still public; this
is the short way in, not a wall around them.
"""

from __future__ import annotations

from pathlib import Path

from .layout.loader import load_path, load_text
from .signalling.interlocking import Interlocking, build_interlocking
from .tables.control_table import ControlTable, build_control_table
from .topology.scheme import Scheme, build_scheme
from .verify import checks as _checks  # noqa: F401  (registers the rules)
from .verify.report import Report
from .verify.rules import Context, run


def load(path: str | Path) -> Scheme:
    """Read a scheme plan, following any includes, and assemble it.

    >>> scheme = load("examples/ashcombe.sbx")
    >>> scheme.area
    'Ashcombe'
    """
    return build_scheme(load_path(path))


def parse(text: str, *, source: str = "<string>") -> Scheme:
    """Assemble a scheme from plan text rather than a file."""
    return build_scheme(load_text(text, source=source))


def interlocking(scheme: Scheme) -> Interlocking:
    """Work out every route in a scheme, with its overlaps and its flanks.

    >>> lock = interlocking(load("examples/ashcombe.sbx"))
    >>> sorted(plan.name for plan in lock)[0]
    'A1(M)'
    """
    return build_interlocking(scheme)


def control_table(scheme: Scheme, lock: Interlocking | None = None) -> ControlTable:
    """The control table for a scheme, working the interlocking out if need be."""
    return build_control_table(scheme, lock or build_interlocking(scheme))


def check(scheme: Scheme, lock: Interlocking | None = None) -> Report:
    """Run every rule against a scheme and give back what they found.

    >>> report = check(load("examples/ashcombe.sbx"))
    >>> report.ok in (True, False)
    True
    """
    return run(Context(scheme=scheme, interlocking=lock or build_interlocking(scheme)))
