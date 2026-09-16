"""What an interchange file has to look like, written down.

The reader used to check three or four things and hope. Whoever is on the other
end of the file needs to know exactly what they are getting, and this is that
list: every field, what kind of thing it is, and whether it has to be there.
It doubles as the validator, so the description and the check cannot drift.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class Field:
    """One field of one record."""

    name: str
    kind: type | tuple[type, ...]
    required: bool = True
    note: str = ""

    def check(self, record: dict[str, Any], where: str) -> str | None:
        if self.name not in record:
            return None if not self.required else f"{where} has no {self.name}"
        value = record[self.name]
        if value is None and not self.required:
            return None
        if not isinstance(value, self.kind):
            wanted = getattr(self.kind, "__name__", str(self.kind))
            return f"{where}.{self.name} is {type(value).__name__}, expected {wanted}"
        return None

    def __str__(self) -> str:
        wanted = getattr(self.kind, "__name__", "one of several")
        tail = "" if self.required else ", optional"
        return f"{self.name}: {wanted}{tail}"


TRACK = (
    Field("name", str),
    Field("from", str),
    Field("to", str),
    Field("length", (int, float)),
    Field("speed", (int, float), required=False, note="miles per hour"),
    Field("gradient", str),
    Field("direction", str),
    Field("mileage", (int, float), required=False, note="metres from the datum"),
)

CROSSINGS = (
    Field("name", str),
    Field("edge", str),
    Field("offset", (int, float)),
    Field("kind", str),
    Field("strike_in", (int, float)),
    Field("requirement", str),
)

TRAPS = (
    Field("name", str),
    Field("edge", str),
    Field("offset", (int, float)),
    Field("facing", str),
)

SECTIONS = (
    Field("name", str),
    Field("kind", str),
    Field("edges", list),
    Field("length", (int, float)),
)

SIGNALS = (
    Field("name", str),
    Field("edge", str),
    Field("offset", (int, float)),
    Field("facing", str),
    Field("heads", int),
    Field("type", str),
    Field("subsidiary", bool),
    Field("automatic", bool),
    Field("direction", str, required=False),
)

ROUTES = (
    Field("name", str),
    Field("entrance", str),
    Field("exit", dict),
    Field("class", str),
    Field("length", (int, float)),
    Field("points", dict),
    Field("points_held", dict),
    Field("overlaps", list),
    Field("flanks", list),
    Field("track", list),
    Field("release", str),
    Field("locks_out", list),
    Field("approach", dict),
    Field("aspects", dict),
)

#: Every list in the file, with the fields each of its records must have.
RECORDS = {
    "track": TRACK,
    "sections": SECTIONS,
    "signals": SIGNALS,
    "crossings": CROSSINGS,
    "traps": TRAPS,
    "routes": ROUTES,
}


def describe() -> str:
    """The schema written out, for anybody who has to read the file."""
    lines = []
    for name, fields in RECORDS.items():
        lines.append(f"{name}:")
        lines.extend(f"  {field}" for field in fields)
    return "\n".join(lines) + "\n"


def problems(data: dict[str, Any]) -> Iterator[str]:
    """Everything wrong with a file, one line at a time."""
    for name, fields in RECORDS.items():
        records = data.get(name)
        if records is None:
            yield f"no {name} in the file"
            continue
        if not isinstance(records, list):
            yield f"{name} is {type(records).__name__}, expected a list"
            continue
        for index, record in enumerate(records):
            if not isinstance(record, dict):
                yield f"{name}[{index}] is {type(record).__name__}, expected an object"
                continue
            where = f"{name}[{record.get('name', index)}]"
            for field in fields:
                found = field.check(record, where)
                if found is not None:
                    yield found


def valid(data: dict[str, Any]) -> bool:
    return not any(problems(data))
