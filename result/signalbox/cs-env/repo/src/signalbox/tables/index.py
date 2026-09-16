"""A cross reference: where is this thing used, and by what.

The question that comes up during testing is never "what does route K1(M) do",
it is "what happens if I take TB out". This answers that: for any section, set
of points, signal or edge, everything in the interlocking that mentions it.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field

from ..signalling.berth import berth_section
from ..signalling.crossing import crossings_over
from ..signalling.interlocking import Interlocking
from ..topology.scheme import Scheme

KINDS = ("signal", "section", "points", "edge", "crossing")


@dataclass(frozen=True)
class Uses:
    """Everything that mentions one thing."""

    name: str
    kind: str
    routes: tuple[str, ...] = ()
    detail: dict[str, tuple[str, ...]] = field(default_factory=dict)

    @property
    def used(self) -> bool:
        return bool(self.routes) or any(self.detail.values())

    def lines(self) -> list[str]:
        found = [f"{self.kind} {self.name}"]
        if self.routes:
            found.append(f"  routes: {', '.join(self.routes)}")
        for heading, values in sorted(self.detail.items()):
            if values:
                found.append(f"  {heading}: {', '.join(values)}")
        if not self.used:
            found.append("  nothing uses it")
        return found

    def __str__(self) -> str:
        return "\n".join(self.lines())


class Index:
    """The cross reference for a whole scheme."""

    def __init__(self, scheme: Scheme, interlocking: Interlocking) -> None:
        self.scheme = scheme
        self.interlocking = interlocking

    def kind_of(self, name: str) -> str | None:
        if name in self.scheme.signals:
            return "signal"
        if name in self.scheme.sections:
            return "section"
        if name in self.scheme.machines:
            return "points"
        if name in self.scheme.graph.edges:
            return "edge"
        if name in self.scheme.crossings:
            return "crossing"
        return None

    def look_up(self, name: str) -> Uses | None:
        """Everything that mentions ``name``, whatever kind of thing it is."""
        kind = self.kind_of(name)
        if kind is None:
            return None
        lookups: dict[str, Callable[[str], Uses]] = {
            "signal": self._signal,
            "section": self._section,
            "points": self._points,
            "edge": self._edge,
            "crossing": self._crossing,
        }
        return lookups[kind](name)

    def _signal(self, name: str) -> Uses:
        entrance = [plan.name for plan in self.interlocking.from_signal(name)]
        exits = [plan.name for plan in self.interlocking.to_signal(name)]
        held = [plan.name for plan in self.interlocking if name in plan.signals_held()]
        return Uses(
            name,
            "signal",
            tuple(entrance),
            {"reads to": tuple(exits), "held for flank by": tuple(held)},
        )

    def _section(self, name: str) -> Uses:
        over = [plan.name for plan in self.interlocking if name in plan.sections]
        overlap = [plan.name for plan in self.interlocking if name in plan.overlap_sections()]
        section = self.scheme.sections.get(name)
        return Uses(
            name,
            "section",
            tuple(over),
            {"in the overlap of": tuple(overlap), "covers": section.edges},
        )

    def _points(self, name: str) -> Uses:
        run_over = [plan.name for plan in self.interlocking if name in plan.points()]
        flank = [plan.name for plan in self.interlocking if name in plan.flank_points()]
        overlap = [plan.name for plan in self.interlocking if name in plan.overlap_points()]
        return Uses(
            name,
            "points",
            tuple(run_over),
            {"called for flank by": tuple(flank), "held for overlap by": tuple(overlap)},
        )

    def _edge(self, name: str) -> Uses:
        over = [plan.name for plan in self.interlocking if plan.route.uses_edge(name)]
        section = self.scheme.sections.name_for(name)
        signals = [s.name for s in self.scheme.signals_on(name)]
        return Uses(
            name,
            "edge",
            tuple(over),
            {
                "in section": (section,) if section else (),
                "signals on it": tuple(signals),
            },
        )

    def _crossing(self, name: str) -> Uses:
        crossing = self.scheme.crossing(name)
        over = [
            plan.name
            for plan in self.interlocking
            if crossing in crossings_over(self.scheme, plan)
        ]
        return Uses(name, "crossing", tuple(over), {"requirement": (crossing.requirement(),)})

    def unused(self) -> list[Uses]:
        """Everything the interlocking never mentions.

        A berth track does not count. No route runs over the piece of track a
        train waits on to see the first signal, and that is not a mistake, it is
        what a berth is.
        """
        berths = {berth_section(self.scheme, name) for name in self.scheme.signals}
        found = []
        for name in sorted(self.scheme.sections.sections):
            if name in berths:
                continue
            uses = self._section(name)
            if not uses.routes and not uses.detail["in the overlap of"]:
                found.append(uses)
        for name in self.scheme.graph.points():
            uses = self._points(name)
            if not uses.used:
                found.append(uses)
        return found


def build_index(scheme: Scheme, interlocking: Interlocking) -> Index:
    return Index(scheme, interlocking)
