"""Terminal text reports. Always use \\n regardless of host."""

from __future__ import annotations

from cueforge.compiler.plan import CompiledShow
from cueforge.findings import Finding
from cueforge.simulation.scheduler import RehearsalResult


def _finding_line(finding: Finding) -> str:
    subject = ""
    if finding.subject_kind and finding.subject_id:
        subject = f" {finding.subject_kind}:{finding.subject_id}"
    elif finding.subject_id:
        subject = f" {finding.subject_id}"
    return f"{finding.severity.upper()} {finding.code}{subject}: {finding.message}"


def render_text_compile(show: CompiledShow | None, findings: tuple[Finding, ...]) -> str:
    lines: list[str] = []
    if show is not None:
        lines.append(f"compiled {show.production_id} digest={show.digest}")
        lines.append(f"cues={len(show.cues)} order={','.join(show.order)}")
        for cue in show.cues:
            start = "unresolved" if cue.start_ms is None else f"{cue.start_ms}ms"
            lines.append(
                f"  {cue.id} dept={cue.department} start={start} duration={cue.duration_ms}ms"
            )
    if findings:
        lines.append("findings:")
        lines.extend(f"  {_finding_line(item)}" for item in findings)
    else:
        lines.append("findings: none")
    return "\n".join(lines) + "\n"


def render_text_rehearse(result: RehearsalResult) -> str:
    lines = [
        f"rehearse {result.compiled.production_id} digest={result.digest}",
        f"events={len(result.events)}",
    ]
    for status in result.statuses:
        lines.append(
            f"  {status.cue_id} {status.status} start={status.start_ms} end={status.end_ms}"
        )
    if result.holds:
        lines.append("holds:")
        for hold in result.holds:
            lines.append(
                f"  {hold.cue_id} called={hold.planned_ms}ms started={hold.start_ms}ms "
                f"held={hold.held_ms}ms waiting_for={','.join(hold.resources)}"
            )
    if result.findings:
        lines.append("findings:")
        lines.extend(f"  {_finding_line(item)}" for item in result.findings)
    else:
        lines.append("findings: none")
    return "\n".join(lines) + "\n"
