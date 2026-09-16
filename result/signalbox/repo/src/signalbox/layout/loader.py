"""Reading scheme plans off disk.

The loader is the only thing in the package that touches the filesystem for
input. It parses and validates in one step because there is never a reason to
want declarations that have not been checked.
"""

from __future__ import annotations

from pathlib import Path

from ..errors import LayoutError
from .ast import SchemeDecl
from .parser import parse
from .validate import validate

#: The conventional extension for a scheme plan.
SUFFIX = ".sbx"


def load_text(text: str, *, source: str = "<string>") -> SchemeDecl:
    """Parse and validate plan text.

    Includes are not followed, because text on its own has no directory to
    resolve them against. Use :func:`load_path` for a plan in more than one file.
    """
    scheme = parse(text, source=source)
    validate(scheme)
    return scheme


def _read(plan: Path) -> str:
    try:
        return plan.read_text(encoding="utf-8")
    except OSError as exc:
        raise LayoutError(f"cannot read {plan}: {exc.strerror}", source=str(plan)) from exc


def load_path(path: str | Path) -> SchemeDecl:
    """Parse and validate the plan at ``path``, following any includes.

    A plan may be split across files: an area file with the track in it and a
    scheme file that includes it and adds the signalling. The included files are
    merged in the order they are named, and the whole lot is validated once at
    the end so that a reference across files resolves.
    """
    plan = Path(path)
    scheme = _load_tree(plan, seen=[])
    validate(scheme)
    return scheme


def _load_tree(plan: Path, seen: list[Path]) -> SchemeDecl:
    resolved = plan.resolve()
    if resolved in seen:
        chain = " -> ".join(p.name for p in [*seen, resolved])
        raise LayoutError(f"include loop: {chain}", source=str(plan))

    scheme = parse(_read(plan), source=str(plan))
    for name in scheme.includes:
        child = (plan.parent / name).resolve()
        scheme.merge(_load_tree(child, [*seen, resolved]))
    return scheme


def load_directory(path: str | Path) -> list[SchemeDecl]:
    """Load every plan in a directory, sorted by name so output is stable."""
    root = Path(path)
    if not root.is_dir():
        raise LayoutError(f"{root} is not a directory")
    return [load_path(plan) for plan in sorted(root.glob(f"*{SUFFIX}"))]
