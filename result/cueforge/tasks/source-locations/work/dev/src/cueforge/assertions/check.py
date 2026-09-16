"""Static checks on authored assertions, run while compiling."""

from __future__ import annotations

from cueforge.assertions.grammar import AfterExpr, BeforeExpr, CueAttr, StateAtExpr, parse_assertion
from cueforge.codes import CF6003_ASSERTION_SUBJECT
from cueforge.findings import Finding, Severity
from cueforge.production.models import Production

# The instants a rehearsal records for every cue, and so the attributes an
# assertion may name.
CUE_ATTRIBUTES = frozenset({"completed", "failed", "started", "visible"})


def _subject_finding(message: str, subject_id: str) -> Finding:
    return Finding(
        code=CF6003_ASSERTION_SUBJECT,
        severity=Severity.ERROR,
        message=message,
        subject_kind="assertion",
        subject_id=subject_id,
    )


def _check_attr(attr: CueAttr, cue_ids: frozenset[str]) -> list[Finding]:
    if attr.cue_id not in cue_ids:
        return [_subject_finding(f"assertion refers to unknown cue {attr.cue_id!r}", attr.cue_id)]
    if attr.attr not in CUE_ATTRIBUTES:
        return [
            _subject_finding(
                f"assertion refers to unknown attribute {attr.cue_id}.{attr.attr}",
                f"{attr.cue_id}.{attr.attr}",
            )
        ]
    return []


def allowed_states(production: Production, resource_id: str) -> tuple[str, ...]:
    """The states a resource can be in, the way a rehearsal sees them."""
    resource = production.resources[resource_id]
    if resource.states:
        return tuple(resource.states)
    if resource.initial_state:
        return (resource.initial_state,)
    return ("idle",)


def check_assertions(production: Production) -> list[tuple[int, Finding]]:
    """Return ``(index, finding)`` for every assertion that cannot be evaluated.

    Syntax errors come back as CF6002; a cue, attribute, resource or state
    the production does not declare as CF6003.  The index says which
    ``assertions`` entry the finding is about.
    """
    cue_ids = frozenset(production.cue_ids())
    out: list[tuple[int, Finding]] = []
    for index, item in enumerate(production.assertions):
        expr, parse_finding = parse_assertion(item.expression)
        if parse_finding is not None:
            out.append((index, parse_finding))
            continue
        findings: list[Finding] = []
        if isinstance(expr, (BeforeExpr, AfterExpr)):
            findings.extend(_check_attr(expr.left, cue_ids))
            findings.extend(_check_attr(expr.right, cue_ids))
        elif isinstance(expr, StateAtExpr):
            findings.extend(_check_attr(expr.at, cue_ids))
            if expr.resource_id not in production.resources:
                findings.append(
                    _subject_finding(
                        f"assertion refers to unknown resource {expr.resource_id!r}",
                        expr.resource_id,
                    )
                )
            elif expr.expected not in allowed_states(production, expr.resource_id):
                findings.append(
                    _subject_finding(
                        f"resource {expr.resource_id!r} has no state {expr.expected!r}",
                        f"{expr.resource_id}.{expr.expected}",
                    )
                )
        out.extend((index, finding) for finding in findings)
    return out
