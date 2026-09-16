"""Telling whether two interchange files mean the same thing.

A stage handover asks one question: has anything changed since the version that
was signed off, and if so, what. Comparing the files directly answers it without
either scheme plan being available, which matters when the answer is needed by
somebody who only has the data.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

#: The parts of a route worth reporting a change in, in the order they print.
ROUTE_FIELDS = (
    "entrance",
    "exit",
    "class",
    "points",
    "points_held",
    "track",
    "release",
    "locks_out",
    "overlaps",
    "flanks",
    "approach",
    "aspects",
)


@dataclass(frozen=True)
class Difference:
    """One thing that is not the same in the two files."""

    where: str
    field: str
    before: Any
    after: Any

    def __str__(self) -> str:
        return f"{self.where} {self.field}: {_short(self.before)} -> {_short(self.after)}"


def _short(value: Any) -> str:
    if value is None:
        return "-"
    if isinstance(value, list):
        return ", ".join(str(item) for item in value) or "-"
    if isinstance(value, dict):
        return ", ".join(f"{k}={v}" for k, v in sorted(value.items())) or "-"
    return str(value)


@dataclass
class Comparison:
    """Everything that differs between two interchange files."""

    added: list[str] = field(default_factory=list)
    removed: list[str] = field(default_factory=list)
    changed: list[Difference] = field(default_factory=list)

    @property
    def same(self) -> bool:
        return not (self.added or self.removed or self.changed)

    def routes_touched(self) -> list[str]:
        names = set(self.added) | set(self.removed)
        names.update(difference.where for difference in self.changed)
        return sorted(names)

    def summary(self) -> str:
        if self.same:
            return "identical"
        return (
            f"{len(self.added)} added, {len(self.removed)} removed, {len(self.changed)} changed"
        )

    def report(self) -> str:
        lines = [f"added {name}" for name in self.added]
        lines += [f"removed {name}" for name in self.removed]
        lines += [str(difference) for difference in self.changed]
        lines.append(self.summary())
        return "\n".join(lines) + "\n"

    def as_dict(self) -> dict[str, Any]:
        """The comparison in a shape another program can read."""
        return {
            "same": self.same,
            "added": list(self.added),
            "removed": list(self.removed),
            "changed": [
                {
                    "where": difference.where,
                    "field": difference.field,
                    "before": _short(difference.before),
                    "after": _short(difference.after),
                }
                for difference in self.changed
            ],
            "routes_touched": self.routes_touched(),
            "summary": self.summary(),
        }

    def json(self) -> str:
        return json.dumps(self.as_dict(), indent=2, sort_keys=True) + "\n"


def _zones(data: dict[str, Any]) -> dict[str, str]:
    """Section name to the reset zone it is in, for the counted sections only."""
    return {
        str(section.get("name")): str(section.get("zone"))
        for section in data.get("sections", [])
        if section.get("zone")
    }


def _heads(data: dict[str, Any]) -> dict[str, list[Any]]:
    """Section name to the counting heads that bound it."""
    return {
        str(section.get("name")): list(section.get("heads") or [])
        for section in data.get("sections", [])
        if section.get("heads")
    }


def detection_differences(before: dict[str, Any], after: dict[str, Any]) -> list[Difference]:
    """Reset zones and counting heads that are not what they were.

    A section moving between zones is worth calling out on its own, because it
    changes what has to be proved clear before the section can be reset, and
    that does not show up anywhere in the routes.
    """
    old_zones, new_zones = _zones(before), _zones(after)
    old_heads, new_heads = _heads(before), _heads(after)
    found = [
        Difference(name, "reset zone", old_zones.get(name), new_zones.get(name))
        for name in sorted(set(old_zones) | set(new_zones))
        if old_zones.get(name) != new_zones.get(name)
    ]
    found.extend(
        Difference(name, "heads", old_heads.get(name), new_heads.get(name))
        for name in sorted(set(old_heads) | set(new_heads))
        if old_heads.get(name) != new_heads.get(name)
    )
    return found


def compare(before: dict[str, Any], after: dict[str, Any]) -> Comparison:
    """Compare two interchange files route by route, then the scheme itself."""
    result = Comparison()

    old = {route["name"]: route for route in before.get("routes", [])}
    new = {route["name"]: route for route in after.get("routes", [])}

    result.added = sorted(set(new) - set(old))
    result.removed = sorted(set(old) - set(new))

    for name in sorted(set(old) & set(new)):
        for key in ROUTE_FIELDS:
            if old[name].get(key) != new[name].get(key):
                result.changed.append(
                    Difference(name, key, old[name].get(key), new[name].get(key))
                )

    result.changed.extend(detection_differences(before, after))

    for key in ("scheme", "sections", "signals", "track"):
        if before.get(key) != after.get(key):
            result.changed.append(
                Difference("scheme", key, _count(before.get(key)), _count(after.get(key)))
            )
    return result


def _count(value: Any) -> Any:
    if isinstance(value, list):
        return f"{len(value)} entries"
    return value
