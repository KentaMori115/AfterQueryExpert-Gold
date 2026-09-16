"""Every way into the side of a route has to be shut by something.

An unprotected flank is the sort of thing that is obvious on a diagram and
invisible in a table, which is exactly why it is worth a rule. The check also
picks up the weaker cases: protection that depends on a signal being held rather
than on points lying away from the route is real protection, but it is worth
knowing about, because a signal can be passed at danger and a set of points
cannot be run through without breaking something.
"""

from __future__ import annotations

from collections.abc import Iterator

from ...signalling.flank import FlankKind
from ..report import Finding, Severity
from ..rules import Context, rule


@rule("flank-open", "every flank is protected by something", Severity.ERROR)
def flanks_are_protected(context: Context) -> Iterator[Finding]:
    """Report flanks where nothing at all was found within the search distance."""
    for plan in context.plans():
        for flank in plan.unprotected_flanks():
            where = f"{flank.node}.{flank.port}" if flank.port else flank.node
            yield Finding(
                rule="flank-open",
                severity=Severity.ERROR,
                subject=plan.name,
                message=f"nothing protects the flank at {where}",
                detail=f"searched {flank.distance.metres:.0f}m",
            )


@rule("flank-signal", "flank protection by held signal only", Severity.WARNING)
def flank_by_signal_only(context: Context) -> Iterator[Finding]:
    """Note flanks where the only protection is a signal held at danger."""
    for plan in context.plans():
        for flank in plan.flanks:
            if flank.kind is not FlankKind.SIGNAL:
                continue
            where = f"{flank.node}.{flank.port}" if flank.port else flank.node
            yield Finding(
                rule="flank-signal",
                severity=Severity.WARNING,
                subject=plan.name,
                message=f"the flank at {where} is held only by {flank.element}",
                detail="no points lie away from the route here",
            )


@rule("flank-shared", "flank points wanted two ways at once", Severity.ERROR)
def flank_points_do_not_fight(context: Context) -> Iterator[Finding]:
    """A set of points cannot protect one route and carry another at the same time."""
    wanted: dict[str, dict[str, str]] = {}
    for plan in context.plans():
        for node, lie in plan.flank_points().items():
            wanted.setdefault(node, {})[plan.name] = lie.value

    for node, callers in sorted(wanted.items()):
        lies = set(callers.values())
        if len(lies) > 1:
            routes = ", ".join(sorted(callers))
            yield Finding(
                rule="flank-shared",
                severity=Severity.ERROR,
                subject=node,
                message="called for flank protection both ways",
                detail=routes,
            )
