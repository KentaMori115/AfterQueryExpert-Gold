"""CLI command implementations."""

from __future__ import annotations

from typing import Any

from pathlib import Path

from cueforge.api import compile_production, load_production, rehearse, sheet_for
from cueforge.cli.presentation import parse_delay_option
from cueforge.findings import Severity
from cueforge.reports.canonical_json import canonical_dumps
from cueforge.reports.text import render_text_compile, render_text_rehearse
from cueforge.reports.trace import events_to_ndjson
from cueforge.simulation.interventions import DelayCue, FailCue
from cueforge.store.disk import DiskRunStore
from cueforge.store.protocol import RunRecord


def _exit_from_findings(findings: tuple[object, ...]) -> int:
    from cueforge.findings import Finding

    for item in findings:
        if isinstance(item, Finding) and item.severity == Severity.ERROR:
            return 1
    return 0


def _finding_payload(item: Any) -> dict[str, object]:
    """One finding as compile JSON prints it.

    ``source`` is the object rehearsal JSON prints, and like there it appears
    only when the finding is about an authored node.
    """
    payload: dict[str, object] = {
        "code": item.code,
        "message": item.message,
        "severity": str(item.severity),
        "subject_id": item.subject_id,
        "subject_kind": item.subject_kind,
        "witness": dict(item.witness),
    }
    source = getattr(item, "source", None)
    if source is not None:
        payload["source"] = {"column": source.column, "line": source.line, "path": source.path}
    return payload


def cmd_compile(path: Path, fmt: str) -> tuple[str, int]:
    loaded = load_production(path)
    if not loaded.is_ok or loaded.value is None:
        if fmt == "json":
            text = canonical_dumps(
                {
                    "findings": [
                        _finding_payload(item)
                        for item in loaded.findings
                    ],
                    "ok": False,
                }
            )
        else:
            text = render_text_compile(None, loaded.findings)
        return text, 1
    compiled = compile_production(loaded.value)
    if fmt == "json":
        payload = {
            "findings": [
                _finding_payload(item)
                for item in compiled.findings
            ],
            "ok": compiled.is_ok,
            "show": compiled.value.semantic_dict() if compiled.value is not None else None,
        }
        text = canonical_dumps(payload)
    else:
        text = render_text_compile(compiled.value, compiled.findings)
    return text, 0 if compiled.is_ok else 1


def cmd_rehearse(
    path: Path,
    fmt: str,
    delays: list[str],
    fails: list[str],
) -> tuple[str, int]:
    loaded = load_production(path)
    if not loaded.is_ok or loaded.value is None:
        return cmd_compile(path, fmt)[0], 1
    compiled = compile_production(loaded.value)
    if compiled.value is None:
        return render_text_compile(None, compiled.findings) if fmt != "json" else canonical_dumps(
            {"findings": [item.code for item in compiled.findings], "ok": False}
        ), 1
    interventions: list[DelayCue | FailCue] = []
    for raw in delays:
        cue_id, delay_ms = parse_delay_option(raw)
        interventions.append(DelayCue(cue_id=cue_id, delay_ms=delay_ms))
    for cue_id in fails:
        interventions.append(FailCue(cue_id=cue_id))
    result = rehearse(compiled.value, interventions)
    if fmt == "json":
        text = canonical_dumps(result.semantic_dict())
    elif fmt == "ndjson":
        text = events_to_ndjson(result.events)
    else:
        text = render_text_rehearse(result)
    return text, 0 if not any(item.severity == Severity.ERROR for item in result.findings) else 1


def cmd_sheet(path: Path, department: str | None, output: Path | None) -> tuple[str, int]:
    loaded = load_production(path)
    if not loaded.is_ok or loaded.value is None:
        return render_text_compile(None, loaded.findings), 1
    compiled = compile_production(loaded.value)
    if compiled.value is None:
        return render_text_compile(None, compiled.findings), 1
    sheet = sheet_for(compiled.value, department)
    text = canonical_dumps(sheet.semantic_dict())
    if output is not None:
        output.write_text(text, encoding="utf-8", newline="\n")
        return "", 0 if compiled.is_ok else 1
    return text, 0 if compiled.is_ok else 1


def cmd_report(path: Path, fmt: str) -> tuple[str, int]:
    return cmd_rehearse(path, fmt, [], [])


def cmd_runs_inspect(path: Path, digest: str) -> tuple[str, int]:
    store = DiskRunStore(path if path.is_dir() else path.parent)
    result = store.get(digest)
    if not result.is_ok or result.value is None:
        return render_text_compile(None, result.findings), 3
    return canonical_dumps(dict(result.value.payload)), 0


def cmd_runs_put_rehearse(path: Path) -> tuple[str, int]:
    loaded = load_production(path)
    if not loaded.is_ok or loaded.value is None:
        return render_text_compile(None, loaded.findings), 1
    compiled = compile_production(loaded.value)
    if compiled.value is None:
        return render_text_compile(None, compiled.findings), 1
    result = rehearse(compiled.value)
    store = DiskRunStore(path if path.is_dir() else path.parent)
    stored = store.put(
        RunRecord(
            digest=result.digest,
            kind="rehearse",
            payload=result.semantic_dict(),
            artifacts={},
        )
    )
    if not stored.is_ok:
        return render_text_compile(None, stored.findings), 3
    return canonical_dumps({"digest": result.digest}), 0
