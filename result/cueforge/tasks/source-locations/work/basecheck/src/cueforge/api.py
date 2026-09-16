"""Public CueForge library API. No printing, no sys.exit."""

from __future__ import annotations

from pathlib import Path

from cueforge.compiler.plan import CompiledShow, compile_production_document
from cueforge.production.build import production_from_mapping
from cueforge.production.discovery import load_merged_mapping
from cueforge.production.models import Production
from cueforge.reports.canonical_json import canonical_dumps
from cueforge.reports.sheets import CueSheet, render_sheet
from cueforge.result import Result
from cueforge.simulation.interventions import Intervention
from cueforge.simulation.scheduler import RehearsalResult, run_rehearsal


def load_production(source: str | Path) -> Result[Production]:
    path = Path(source)
    data, findings, source_path = load_merged_mapping(path)
    if data is None:
        return Result.fail(findings)
    production, build_findings = production_from_mapping(data, source_path)
    findings.extend(build_findings)
    if production is None:
        return Result.fail(findings)
    return Result.ok(production, findings)


def compile_production(production: Production) -> Result[CompiledShow]:
    show, findings = compile_production_document(production)
    if show is None:
        return Result.fail(findings)
    return Result.ok(show, findings)


def rehearse(
    compiled: CompiledShow,
    interventions: list[Intervention] | tuple[Intervention, ...] = (),
) -> RehearsalResult:
    return run_rehearsal(compiled, interventions)


def sheet_for(compiled: CompiledShow, department: str | None = None) -> CueSheet:
    return render_sheet(compiled, department)


def dumps_canonical(value: object) -> str:
    return canonical_dumps(value)
