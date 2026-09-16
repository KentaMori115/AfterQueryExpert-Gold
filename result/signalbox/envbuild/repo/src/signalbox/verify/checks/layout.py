"""The layout itself, before any signalling is laid over it.

These rules catch the sort of thing that is obvious once somebody says it and
invisible until they do: a piece of track nothing can reach, a siding nothing
can leave, and signals that do not follow the naming the rest of the scheme
uses, which is how a signal ends up being called two different things in two
different documents.
"""

from __future__ import annotations

from collections.abc import Iterator

from ...topology.reachability import dead_ends, unreachable_edges
from ..report import Finding, Severity
from ..rules import Context, rule


@rule("layout-stranded", "every piece of track can be reached", Severity.ERROR)
def all_track_can_be_reached(context: Context) -> Iterator[Finding]:
    scheme = context.scheme
    for edge in unreachable_edges(scheme):
        section = scheme.sections.name_for(edge) or "no section"
        either_way = edge not in unreachable_edges(scheme, respect_direction=False)
        detail = (
            "only the direction of working stops it"
            if either_way
            else "nothing joins it to the rest of the scheme"
        )
        yield Finding(
            rule="layout-stranded",
            severity=Severity.ERROR,
            subject=edge,
            message=f"no train can reach this edge from a boundary ({section})",
            detail=detail,
        )


@rule("layout-deadend", "a train can get out of every siding", Severity.WARNING)
def sidings_can_be_left(context: Context) -> Iterator[Finding]:
    scheme = context.scheme
    for edge in dead_ends(scheme):
        yield Finding(
            rule="layout-deadend",
            severity=Severity.WARNING,
            subject=edge,
            message="a train can get in here but the direction of working will not let it out",
            detail=f"worked {scheme.graph.edge(edge).direction} only",
        )


@rule("layout-naming", "signals follow the scheme prefix", Severity.ADVICE)
def signals_are_named_consistently(context: Context) -> Iterator[Finding]:
    scheme = context.scheme
    prefix = scheme.prefix
    if not prefix:
        return
    for signal in scheme.sorted_signals():
        if signal.name.startswith(prefix):
            continue
        yield Finding(
            rule="layout-naming",
            severity=Severity.ADVICE,
            subject=signal.name,
            message=f"does not start with the scheme prefix {prefix!r}",
            detail="the plan, the table and the panel will not agree",
        )


@rule("layout-numbering", "signal numbers are odd or even by direction", Severity.ADVICE)
def signal_numbers_follow_direction(context: Context) -> Iterator[Finding]:
    """Down signals are conventionally odd numbered and up signals even."""
    scheme = context.scheme
    for signal in scheme.sorted_signals():
        direction = signal.attributes.get("direction")
        digits = "".join(ch for ch in signal.name if ch.isdigit())
        if direction not in ("up", "down") or not digits:
            continue
        odd = int(digits) % 2 == 1
        if (direction == "down") == odd:
            continue
        wanted = "odd" if direction == "down" else "even"
        yield Finding(
            rule="layout-numbering",
            severity=Severity.ADVICE,
            subject=signal.name,
            message=f"an {direction} signal numbered {digits}, expected {wanted}",
            detail="the usual convention is odd for down and even for up",
        )
