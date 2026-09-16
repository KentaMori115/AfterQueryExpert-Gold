"""The head schedule: every counting head, and the zone its section resets with.

A scheme with axle counters is handed over with a list of where the heads go,
the same way one with track circuits is handed over with a list of where the
joints go. This is that list, read out of the layout rather than drawn on it,
so it cannot disagree with the plan it came from.

The zone column is the part nobody expects. Two counted sections a train can run
directly between keep one another's count honest and have to be reset as a pair,
so the schedule says which sections come out of use together. A zone of one is
the ordinary case and reads as a dash.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass

from ..topology.counting import CountingPlan, Head, build_counting
from ..topology.scheme import Scheme

HEAD_COLUMNS = (
    "head",
    "at",
    "kind",
    "section",
    "edge",
    "zone",
    "reset with",
)

ZONE_COLUMNS = (
    "zone",
    "sections",
    "heads",
    "reset together",
)


@dataclass(frozen=True)
class HeadRow:
    """One counting head, read as a row."""

    head: str
    at: str
    kind: str
    section: str
    edge: str
    zone: str
    reset_with: tuple[str, ...]

    @property
    def is_shared(self) -> bool:
        """Whether resetting this head's section takes another one with it."""
        return bool(self.reset_with)

    def cell(self, column: str) -> str:
        value = {
            "head": self.head,
            "at": self.at,
            "kind": self.kind,
            "section": self.section,
            "edge": self.edge,
            "zone": self.zone,
            "reset with": self.reset_with or ("-",),
        }[column]
        return ", ".join(value) if isinstance(value, tuple) else str(value)

    def as_dict(self) -> dict[str, str]:
        return {column: self.cell(column) for column in HEAD_COLUMNS}

    def __str__(self) -> str:
        return f"{self.head} on {self.section}"


@dataclass(frozen=True)
class ZoneRow:
    """One reset zone, read as a row."""

    zone: str
    sections: tuple[str, ...]
    heads: tuple[str, ...]
    """The heads bounding the zone, in name order and without repeats."""

    @property
    def is_single(self) -> bool:
        return len(self.sections) == 1

    def cell(self, column: str) -> str:
        value = {
            "zone": self.zone,
            "sections": self.sections,
            "heads": self.heads,
            "reset together": "no" if self.is_single else "yes",
        }[column]
        return ", ".join(value) if isinstance(value, tuple) else str(value)

    def __str__(self) -> str:
        return f"{self.zone}: {', '.join(self.sections)}"


class HeadSchedule:
    """Every head and every reset zone in a scheme."""

    def __init__(self, rows: list[HeadRow], zones: list[ZoneRow], plan: CountingPlan) -> None:
        self.rows = rows
        self.zones = zones
        self.plan = plan

    def __len__(self) -> int:
        return len(self.rows)

    def __iter__(self) -> Iterator[HeadRow]:
        return iter(self.rows)

    @property
    def is_empty(self) -> bool:
        return not self.rows and not self.zones

    def for_section(self, section: str) -> list[HeadRow]:
        return [row for row in self.rows if row.section == section]

    def at_node(self, node: str) -> list[HeadRow]:
        return [row for row in self.rows if row.at == node]

    def wide(self) -> list[ZoneRow]:
        """Zones covering more than one section."""
        return [zone for zone in self.zones if not zone.is_single]

    def column(self, name: str) -> list[str]:
        return [row.cell(name) for row in self.rows]

    def describe(self) -> str:
        wide = len(self.wide())
        tail = "" if not wide else f", {wide} of them shared"
        return f"{len(self.rows)} counting heads over {len(self.zones)} reset zones{tail}"


def _row_for(scheme: Scheme, plan: CountingPlan, head: Head) -> HeadRow:
    zone = plan.zone_of(head.section)
    return HeadRow(
        head=head.name,
        at=head.node,
        kind=scheme.graph.node(head.node).kind.value,
        section=head.section,
        edge=head.edge,
        zone=zone.name if zone else "",
        reset_with=tuple(
            other for other in (zone.sections if zone else ()) if other != head.section
        ),
    )


def build_head_schedule(scheme: Scheme) -> HeadSchedule:
    """Read the head schedule straight out of a scheme's counted sections.

    Nothing is cached and nothing is stored on the scheme: the schedule is a
    view of the layout, and a layout that has changed has a different schedule.
    Building it is walking the counted sections once, which is cheap enough that
    holding a stale copy would cost more than it saved.
    """
    plan = build_counting(scheme.graph, scheme.sections)
    rows = [_row_for(scheme, plan, head) for head in plan.heads]
    zones = [
        ZoneRow(
            zone=zone.name,
            sections=zone.sections,
            heads=tuple(
                sorted(
                    {
                        head.name
                        for section in zone.sections
                        for head in plan.heads_for_section(section)
                    }
                )
            ),
        )
        for zone in plan.zones
    ]
    return HeadSchedule(rows, zones, plan)
