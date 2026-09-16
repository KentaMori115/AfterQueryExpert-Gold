"""Reading interchange files written by an older version.

A file that was handed over eighteen months ago has to still be readable, or the
comparison that a stage handover turns on cannot be made. Each migration brings
one version up to the next, and the chain is applied in order, so adding a
version means writing one function and adding one line.

A migration never invents data. Where a newer version has a field the older one
did not, the field comes out empty and is honest about it.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from .model import SCHEMA_VERSION

Migration = Callable[[dict[str, Any]], dict[str, Any]]


def _one_to_two(data: dict[str, Any]) -> dict[str, Any]:
    """Version 2 added the standards, the crossings, the traps and the mileage.

    None of them can be worked out from a version 1 file, so they come out as
    the defaults and as empty lists. A reader that cares can tell, because the
    standards will be exactly the package defaults.
    """
    found = dict(data)
    found.setdefault("written_by", "signalbox before 0.3.0")
    found.setdefault("standards", {})
    found.setdefault("crossings", [])
    found.setdefault("traps", [])
    found["track"] = [{"mileage": None, **edge} for edge in found.get("track", [])]
    found["schema"] = 2
    return found


#: One migration per step, keyed by the version it takes a file from.
MIGRATIONS: dict[int, Migration] = {
    1: _one_to_two,
}


def needs_migrating(data: dict[str, Any]) -> bool:
    return int(data.get("schema", SCHEMA_VERSION)) < SCHEMA_VERSION


def migrate(data: dict[str, Any]) -> dict[str, Any]:
    """Bring a file up to the current version, one step at a time."""
    found = dict(data)
    version = int(found.get("schema", SCHEMA_VERSION))

    while version < SCHEMA_VERSION:
        step = MIGRATIONS.get(version)
        if step is None:
            raise KeyError(f"no migration from schema {version}")
        found = step(found)
        moved = int(found.get("schema", version))
        if moved <= version:
            raise RuntimeError(f"the migration from {version} did not move the version on")
        version = moved

    return found


def path_from(version: int) -> list[int]:
    """The versions a file of this version would be taken through."""
    found = []
    while version < SCHEMA_VERSION:
        found.append(version)
        if version not in MIGRATIONS:
            break
        version += 1
    return found
