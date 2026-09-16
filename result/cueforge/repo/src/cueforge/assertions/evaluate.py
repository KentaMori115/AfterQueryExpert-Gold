"""Evaluate Paper Tech assertions against rehearsal instants."""

from __future__ import annotations

from cueforge.assertions.grammar import AfterExpr, AssertionExpr, BeforeExpr, StateAtExpr, parse_assertion
from cueforge.codes import CF6001_ASSERTION_FAILED, CF6003_ASSERTION_SUBJECT
from cueforge.findings import Finding, Severity


def _attr_time(
    instants: dict[str, dict[str, int | None]],
    cue_id: str,
    attr: str,
) -> tuple[int | None, Finding | None]:
    if cue_id not in instants:
        return None, Finding(
            code=CF6003_ASSERTION_SUBJECT,
            severity=Severity.ERROR,
            message=f"assertion refers to unknown cue {cue_id!r}",
            subject_kind="assertion",
            subject_id=cue_id,
        )
    if attr not in instants[cue_id]:
        return None, Finding(
            code=CF6003_ASSERTION_SUBJECT,
            severity=Severity.ERROR,
            message=f"assertion refers to unknown attribute {cue_id}.{attr}",
            subject_kind="assertion",
            subject_id=f"{cue_id}.{attr}",
        )
    return instants[cue_id][attr], None


def _state_at_time(
    timeline: list[tuple[int, int, object, object]],
    resource_id: str,
    time_ms: int,
    initial: str,
) -> str:
    current = initial
    for event_time, _seq, resource, to_state in timeline:
        if resource != resource_id:
            continue
        if event_time > time_ms:
            break
        if isinstance(to_state, str):
            current = to_state
    return current


def evaluate_one(
    expression: str,
    instants: dict[str, dict[str, int | None]],
    final_states: dict[str, str],
    timeline: list[tuple[int, int, object, object]],
    initials: dict[str, str] | None = None,
) -> list[Finding]:
    expr, parse_finding = parse_assertion(expression)
    if parse_finding is not None:
        return [parse_finding]
    assert expr is not None
    return _eval_expr(expression, expr, instants, final_states, timeline, initials or final_states)


def _eval_expr(
    expression: str,
    expr: AssertionExpr,
    instants: dict[str, dict[str, int | None]],
    final_states: dict[str, str],
    timeline: list[tuple[int, int, object, object]],
    initials: dict[str, str],
) -> list[Finding]:
    if isinstance(expr, (BeforeExpr, AfterExpr)):
        left_t, left_f = _attr_time(instants, expr.left.cue_id, expr.left.attr)
        right_t, right_f = _attr_time(instants, expr.right.cue_id, expr.right.attr)
        findings = [item for item in (left_f, right_f) if item is not None]
        if findings:
            return findings
        if left_t is None or right_t is None:
            return [
                Finding(
                    code=CF6001_ASSERTION_FAILED,
                    severity=Severity.ERROR,
                    message=f"assertion could not bind times: {expression}",
                    subject_kind="assertion",
                    subject_id=expression,
                    witness={"left": str(left_t), "right": str(right_t)},
                )
            ]
        ok = left_t < right_t if isinstance(expr, BeforeExpr) else left_t > right_t
        if not ok:
            return [
                Finding(
                    code=CF6001_ASSERTION_FAILED,
                    severity=Severity.ERROR,
                    message=f"assertion failed: {expression}",
                    subject_kind="assertion",
                    subject_id=expression,
                    witness={"left_ms": left_t, "right_ms": right_t},
                )
            ]
        return []

    assert isinstance(expr, StateAtExpr)
    at_t, at_f = _attr_time(instants, expr.at.cue_id, expr.at.attr)
    if at_f is not None:
        return [at_f]
    if at_t is None:
        return [
            Finding(
                code=CF6001_ASSERTION_FAILED,
                severity=Severity.ERROR,
                message=f"assertion could not bind time: {expression}",
                subject_kind="assertion",
                subject_id=expression,
            )
        ]
    if expr.resource_id not in initials and expr.resource_id not in final_states:
        return [
            Finding(
                code=CF6003_ASSERTION_SUBJECT,
                severity=Severity.ERROR,
                message=f"assertion refers to unknown resource {expr.resource_id!r}",
                subject_kind="assertion",
                subject_id=expr.resource_id,
            )
        ]
    initial = initials.get(expr.resource_id, final_states.get(expr.resource_id, ""))
    actual = _state_at_time(timeline, expr.resource_id, at_t, initial)
    if actual != expr.expected:
        return [
            Finding(
                code=CF6001_ASSERTION_FAILED,
                severity=Severity.ERROR,
                message=f"assertion failed: {expression}",
                subject_kind="assertion",
                subject_id=expression,
                witness={"actual": actual, "expected": expr.expected, "at_ms": at_t},
            )
        ]
    return []


def evaluate_assertions(
    expressions: list[str],
    instants: dict[str, dict[str, int | None]],
    final_states: dict[str, str],
    timeline: list[tuple[int, int, object, object]],
    initials: dict[str, str] | None = None,
) -> list[Finding]:
    findings: list[Finding] = []
    for expression in expressions:
        findings.extend(evaluate_one(expression, instants, final_states, timeline, initials))
    return findings
