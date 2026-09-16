"""A stable, flat description of everything derived from a scheme.

The shape of this dictionary is the contract with anybody downstream, so it is
versioned and it is written out sorted. Nothing here is clever: the point is
that two runs over the same plan produce byte identical output, and a diff
between two versions is a diff of the design and not of the formatting.
"""

from __future__ import annotations

from typing import Any

from .. import __version__
from ..signalling.approach import approach_lock_for
from ..signalling.aspects import AspectChart, build_chart
from ..signalling.conflict import build_matrix
from ..signalling.interlocking import Interlocking
from ..signalling.locking import LockingTable, build_locking
from ..topology.chainage import Chainage, chainage
from ..topology.counting import CountingPlan, build_counting
from ..topology.scheme import Scheme

#: Bumped whenever the shape below changes in a way a reader would notice.
#: Version 2 added the design standards, the crossings, the traps and the
#: mileage, all of which somebody downstream had to go back to the plan for.
SCHEMA_VERSION = 2


def as_dict(scheme: Scheme, interlocking: Interlocking) -> dict[str, Any]:
    """Everything about a scheme, in one plain dictionary."""
    matrix = build_matrix(interlocking)
    locking = build_locking(interlocking, matrix)
    chart = build_chart(scheme, interlocking)

    return {
        "schema": SCHEMA_VERSION,
        "written_by": f"signalbox {__version__}",
        "scheme": _scheme(scheme),
        "standards": _standards(scheme),
        "track": _track(scheme, _marks(scheme)),
        "sections": _sections(scheme),
        "signals": _signals(scheme),
        "crossings": _crossings(scheme),
        "traps": _traps(scheme),
        "routes": [
            _route(scheme, interlocking, locking, chart, plan.name)
            for plan in interlocking.sorted_plans()
        ],
    }


def _scheme(scheme: Scheme) -> dict[str, Any]:
    return {
        "name": scheme.name,
        "area": scheme.area,
        "prefix": scheme.prefix,
    }


def _standards(scheme: Scheme) -> dict[str, Any]:
    figures = scheme.standards
    return {
        "overlap": round(figures.overlap.metres, 3),
        "reduced_overlap": round(figures.reduced_overlap.metres, 3),
        "braking": figures.braking,
        "reaction": figures.reaction,
        "flank": round(figures.flank.metres, 3),
        "approach": figures.approach,
        "throw": figures.throw,
        "route_limit": round(figures.route_limit.metres, 3),
    }


def _crossings(scheme: Scheme) -> list[dict[str, Any]]:
    return [
        {
            "name": name,
            "edge": scheme.crossing(name).position.edge,
            "offset": round(scheme.crossing(name).position.offset.metres, 3),
            "kind": scheme.crossing(name).kind.value,
            "strike_in": scheme.crossing(name).strike_in,
            "requirement": scheme.crossing(name).requirement(),
        }
        for name in sorted(scheme.crossings)
    ]


def _traps(scheme: Scheme) -> list[dict[str, Any]]:
    return [
        {
            "name": name,
            "edge": scheme.trap(name).position.edge,
            "offset": round(scheme.trap(name).position.offset.metres, 3),
            "facing": scheme.trap(name).sense.name.lower(),
        }
        for name in sorted(scheme.traps)
    ]


def _marks(scheme: Scheme) -> Chainage | None:
    """The chainage for a scheme, or None if it was never given a datum."""
    found = chainage(scheme)
    return None if found.is_empty else found


def _track(scheme: Scheme, marks: Chainage | None) -> list[dict[str, Any]]:
    return [
        {
            "name": name,
            "from": str(edge.start),
            "to": str(edge.end),
            "length": round(edge.length.metres, 3),
            "speed": round(edge.speed.mph, 1) if edge.speed else None,
            "gradient": str(edge.gradient),
            "direction": edge.direction,
            "mileage": _mileage(marks, edge.start.node),
        }
        for name, edge in sorted(scheme.graph.edges.items())
    ]


def _mileage(marks: Chainage | None, node: str) -> float | None:
    """The mileage of a node in metres from the datum, if the scheme has one."""
    if marks is None or not marks.known(node):
        return None
    return round(marks.at(node).metres, 3)


def _sections(scheme: Scheme) -> list[dict[str, Any]]:
    counting = build_counting(scheme.graph, scheme.sections)
    return [_section(scheme, counting, name) for name in sorted(scheme.sections.sections)]


def _section(scheme: Scheme, counting: CountingPlan, name: str) -> dict[str, Any]:
    """One section, with its reset zone and heads when it is a counted one."""
    section = scheme.sections.get(name)
    record: dict[str, Any] = {
        "name": name,
        "kind": section.kind.value,
        "edges": list(section.edges),
        "length": round(section.length(scheme.graph).metres, 3),
    }
    zone = counting.zone_of(name)
    if zone is not None:
        record["zone"] = zone.name
        record["heads"] = [head.name for head in counting.heads_for_section(name)]
    return record


def _signals(scheme: Scheme) -> list[dict[str, Any]]:
    return [
        {
            "name": signal.name,
            "edge": signal.position.edge,
            "offset": round(signal.position.offset.metres, 3),
            "facing": signal.position.sense.name.lower(),
            "heads": signal.heads,
            "type": signal.type.value,
            "subsidiary": signal.subsidiary,
            "automatic": signal.automatic,
            "direction": signal.attributes.get("direction"),
        }
        for signal in scheme.sorted_signals()
    ]


def _route(
    scheme: Scheme,
    interlocking: Interlocking,
    locking: LockingTable,
    chart: AspectChart,
    name: str,
) -> dict[str, Any]:
    plan = interlocking.plan(name)
    entry = locking.entry(name)
    rule = chart.rule(name)
    approach = approach_lock_for(scheme, plan)

    return {
        "name": name,
        "entrance": plan.entrance,
        "exit": {"name": plan.route.exit.name, "kind": plan.route.exit.kind.value},
        "class": plan.klass.value,
        "length": round(plan.route.length.metres, 3),
        "points": {node: lie.value for node, lie in sorted(plan.points().items())},
        "points_held": {node: lie.value for node, lie in sorted(entry.points.items())},
        "overlaps": [
            {
                "name": overlap.name,
                "sections": list(overlap.sections),
                "points": {node: lie.value for node, lie in sorted(overlap.points.items())},
                "length": round(overlap.length.metres, 3),
                "full": overlap.full,
            }
            for overlap in plan.overlaps
        ],
        "flanks": [
            {
                "node": flank.node,
                "port": flank.port,
                "kind": flank.kind.value,
                "element": flank.element,
                "lie": flank.lie.value if flank.lie else None,
            }
            for flank in plan.flanks
        ],
        "track": [sub.name for sub in entry.held_track()],
        "release": entry.release.value,
        "locks_out": list(entry.locks_out),
        "approach": {
            "kind": approach.kind.value,
            "watched": list(approach.watched),
            "delay": approach.delay,
        },
        "aspects": (
            {ahead.name.lower(): shown.name.lower() for ahead, shown in rule.table.items()}
            if rule
            else {}
        ),
    }
