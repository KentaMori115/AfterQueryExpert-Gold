"""A written report of a scheme, for the front of the design file.

Everything in here is already available from one command or another. Having it
in one document matters because that is what gets read at a design review, and a
review that has to run six commands to see the shape of a scheme spends its time
running commands.
"""

from __future__ import annotations

from ..signalling.berth import without_berths
from ..signalling.headway import legs, summarise
from ..signalling.interlocking import Interlocking
from ..signalling.route import RouteClass
from ..topology.chainage import chainage
from ..topology.reachability import unreachable_edges
from ..topology.scheme import Scheme
from ..verify.report import Report

RULE = "-" * 72


def _heading(text: str) -> list[str]:
    return ["", text, RULE]


def _layout(scheme: Scheme) -> list[str]:
    graph = scheme.graph
    kinds: dict[str, int] = {}
    for node in graph.nodes.values():
        kinds[node.kind.value] = kinds.get(node.kind.value, 0) + 1
    total = sum(edge.length.metres for edge in graph.edges.values())
    marks = chainage(scheme)

    lines = _heading("Layout")
    lines.append(f"  {len(graph.edges)} edges, {total / 1000:.2f} km of track")
    lines.append("  " + ", ".join(f"{count} {kind}" for kind, count in sorted(kinds.items())))
    lines.append(f"  {len(scheme.sections)} sections, {len(scheme.signals)} signals")
    if scheme.crossings:
        lines.append(f"  {len(scheme.crossings)} level crossings")
    if scheme.traps:
        lines.append(f"  {len(scheme.traps)} traps")
    if not marks.is_empty:
        lines.append(f"  mileage {marks.describe()}")
    stranded = unreachable_edges(scheme)
    if stranded:
        lines.append(f"  unreachable: {', '.join(stranded)}")
    return lines


def _routes(interlocking: Interlocking) -> list[str]:
    counts: dict[str, int] = {}
    for plan in interlocking:
        counts[plan.klass.value] = counts.get(plan.klass.value, 0) + 1
    swinging = [plan.name for plan in interlocking if plan.swinging_overlap]

    lines = _heading("Routes")
    lines.append(f"  {len(interlocking)} routes")
    for klass in RouteClass:
        if klass.value in counts:
            lines.append(f"  {counts[klass.value]} {klass.name.lower().replace('_', ' ')}")
    if swinging:
        lines.append(f"  swinging overlaps: {', '.join(swinging)}")
    return lines


def _protection(scheme: Scheme, interlocking: Interlocking) -> list[str]:
    open_flanks = [
        f"{plan.name} at {flank.node}"
        for plan in interlocking
        for flank in plan.unprotected_flanks()
    ]
    missing = without_berths(scheme)

    lines = _heading("Protection")
    lines.append(f"  {len(open_flanks)} unprotected flanks")
    for entry in open_flanks[:10]:
        lines.append(f"    {entry}")
    if missing:
        lines.append(f"  signals with no berth: {', '.join(missing)}")
    return lines


def _capacity(scheme: Scheme, interlocking: Interlocking) -> list[str]:
    lines = _heading("Capacity")
    lines.append("  " + summarise(legs(scheme, interlocking)))
    return lines


def _findings(report: Report | None) -> list[str]:
    if report is None:
        return []
    lines = _heading("Findings")
    lines.append("  " + report.summary())
    for finding in report.sorted()[:20]:
        lines.append(f"    {finding}")
    if len(report) > 20:
        lines.append(f"    and {len(report) - 20} more")
    return lines


def write_report(
    scheme: Scheme, interlocking: Interlocking, findings: Report | None = None
) -> str:
    """The whole report, as plain text."""
    lines = [
        f"{scheme.area or scheme.name}",
        RULE,
        f"  scheme {scheme.name}, prefix {scheme.prefix or 'none'}",
        f"  designed to {scheme.standards.describe()}",
    ]
    lines += _layout(scheme)
    lines += _routes(interlocking)
    lines += _protection(scheme, interlocking)
    lines += _capacity(scheme, interlocking)
    lines += _findings(findings)
    return "\n".join(lines) + "\n"
