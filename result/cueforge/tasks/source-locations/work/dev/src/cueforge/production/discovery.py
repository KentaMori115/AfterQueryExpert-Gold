"""Discover production sources from a file or workspace directory, with positions."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from cueforge.codes import (
    CF1001_DUPLICATE_ID,
    CF1003_PATH_ESCAPE,
    CF1005_PARSE_ERROR,
    CF1008_EMPTY_DOCUMENT,
)
from cueforge.findings import Finding, Severity, SourceRef
from cueforge.production.json_loader import parse_json_text, parse_json_with_positions
from cueforge.production.merge import merge_documents
from cueforge.production.source_map import SourceMap, is_path_escape, located, posix_relpath
from cueforge.production.yaml_loader import parse_yaml_text, parse_yaml_with_positions

MANIFEST_NAMES = ("cueforge.yaml", "cueforge.yml", "cueforge.json")


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8").replace("\r\n", "\n").replace("\r", "\n")


def parse_document(path: Path, text: str) -> tuple[Any, Finding | None]:
    suffix = path.suffix.lower()
    try:
        if suffix == ".json":
            return parse_json_text(text), None
        if suffix in {".yaml", ".yml"}:
            return parse_yaml_text(text), None
        # Fall back by sniffing.
        stripped = text.lstrip()
        if stripped.startswith("{") or stripped.startswith("["):
            return parse_json_text(text), None
        return parse_yaml_text(text), None
    except Exception as exc:  # noqa: BLE001 — convert parser errors to findings
        return None, Finding(
            code=CF1005_PARSE_ERROR,
            severity=Severity.ERROR,
            message=f"failed to parse {posix_relpath(str(path))}: {exc}",
            subject_kind="document",
            subject_id=posix_relpath(str(path)),
        )


def discover_sources(root: Path) -> tuple[list[Path], list[Finding]]:
    findings: list[Finding] = []
    if root.is_file():
        return [root], findings
    manifest_path: Path | None = None
    for name in MANIFEST_NAMES:
        candidate = root / name
        if candidate.is_file():
            manifest_path = candidate
            break
    if manifest_path is None:
        # Single implicit production file at the root.
        candidates = sorted(
            [
                path
                for path in root.iterdir()
                if path.is_file() and path.suffix.lower() in {".yaml", ".yml", ".json"}
            ],
            key=lambda item: item.name,
        )
        if not candidates:
            findings.append(
                Finding(
                    code=CF1008_EMPTY_DOCUMENT,
                    severity=Severity.ERROR,
                    message=f"no production sources found in {root.as_posix()}",
                    subject_kind="workspace",
                    subject_id=root.as_posix(),
                )
            )
            return [], findings
        return [candidates[0]], findings

    text = read_text(manifest_path)
    document, parse_finding = parse_document(manifest_path, text)
    if parse_finding is not None:
        return [], [parse_finding]
    if not isinstance(document, dict):
        findings.append(
            Finding(
                code=CF1005_PARSE_ERROR,
                severity=Severity.ERROR,
                message="manifest must be a mapping",
                subject_kind="manifest",
                subject_id=posix_relpath(str(manifest_path)),
            )
        )
        return [], findings
    raw_sources = document.get("sources")
    if raw_sources is None:
        return [manifest_path], findings
    if not isinstance(raw_sources, list):
        findings.append(
            Finding(
                code=CF1005_PARSE_ERROR,
                severity=Severity.ERROR,
                message="manifest sources must be a list",
                subject_kind="manifest",
                subject_id="sources",
            )
        )
        return [], findings
    paths: list[Path] = [manifest_path]
    for item in raw_sources:
        if not isinstance(item, str):
            findings.append(
                Finding(
                    code=CF1005_PARSE_ERROR,
                    severity=Severity.ERROR,
                    message="manifest source entries must be strings",
                    subject_kind="manifest",
                    subject_id=str(item),
                )
            )
            continue
        if is_path_escape(item):
            findings.append(
                Finding(
                    code=CF1003_PATH_ESCAPE,
                    severity=Severity.ERROR,
                    message=f"source path escapes the production root: {item}",
                    subject_kind="path",
                    subject_id=item,
                    witness={"path": item},
                )
            )
            continue
        resolved = (root / item).resolve()
        try:
            resolved.relative_to(root.resolve())
        except ValueError:
            findings.append(
                Finding(
                    code=CF1003_PATH_ESCAPE,
                    severity=Severity.ERROR,
                    message=f"source path escapes the production root: {item}",
                    subject_kind="path",
                    subject_id=item,
                )
            )
            continue
        if not resolved.is_file():
            findings.append(
                Finding(
                    code=CF1005_PARSE_ERROR,
                    severity=Severity.ERROR,
                    message=f"source file not found: {item}",
                    subject_kind="path",
                    subject_id=item,
                )
            )
            continue
        paths.append(resolved)
    return paths, findings


def load_merged_mapping(root: Path) -> tuple[dict[str, Any] | None, list[Finding], str]:
    """Load a file or workspace into one mapping. Returns (data, findings, source_path)."""
    findings: list[Finding] = []
    if root.is_file():
        text = read_text(root)
        document, parse_finding = parse_document(root, text)
        if parse_finding is not None:
            return None, [parse_finding], posix_relpath(str(root))
        if document is None:
            return None, [
                Finding(
                    code=CF1008_EMPTY_DOCUMENT,
                    severity=Severity.ERROR,
                    message=f"empty production document: {root.name}",
                    subject_kind="document",
                    subject_id=root.name,
                )
            ], posix_relpath(str(root))
        if not isinstance(document, dict):
            return None, [
                Finding(
                    code=CF1005_PARSE_ERROR,
                    severity=Severity.ERROR,
                    message="production document must be a mapping",
                    subject_kind="document",
                    subject_id=root.name,
                )
            ], posix_relpath(str(root))
        document.pop("sources", None)
        return document, findings, posix_relpath(str(root))

    paths, discover_findings = discover_sources(root)
    findings.extend(discover_findings)
    documents: list[tuple[str, dict[str, Any]]] = []
    for path in paths:
        text = read_text(path)
        document, parse_finding = parse_document(path, text)
        if parse_finding is not None:
            findings.append(parse_finding)
            continue
        if not isinstance(document, dict):
            findings.append(
                Finding(
                    code=CF1005_PARSE_ERROR,
                    severity=Severity.ERROR,
                    message=f"production document must be a mapping: {path.name}",
                    subject_kind="document",
                    subject_id=path.name,
                )
            )
            continue
        rel = path.relative_to(root.resolve()).as_posix() if path.is_relative_to(root.resolve()) else path.name
        document = dict(document)
        document.pop("sources", None)
        documents.append((rel, document))
    if findings:
        return None, findings, root.as_posix()
    merged, merge_findings = merge_documents(documents)
    findings.extend(merge_findings)
    if findings:
        return None, findings, root.as_posix()
    return merged, findings, root.as_posix()


# --- loading with positions -------------------------------------------------
#
# Everything above answers "which files, and what do they say".  The
# functions below answer "and where was each node written", which the
# findings need.  They reuse discovery and merging as they are and only add
# the bookkeeping: one SourceMap per file, folded into one map whose list
# indices follow the merged lists.


@dataclass
class LoadedSource:
    """A production mapping, the findings raised loading it, and where its nodes sit."""

    data: dict[str, Any] | None
    findings: list[Finding]
    source_path: str
    positions: SourceMap = field(default_factory=SourceMap)


def _error_ref(exc: BaseException, rel: str) -> SourceRef | None:
    """Where the parser stopped, when it can say."""
    if isinstance(exc, yaml.MarkedYAMLError) and exc.problem_mark is not None:
        mark = exc.problem_mark
        return SourceRef(path=rel, line=mark.line + 1, column=mark.column + 1)
    if isinstance(exc, json.JSONDecodeError):
        return SourceRef(path=rel, line=exc.lineno, column=exc.colno)
    return None


def parse_document_with_positions(
    path: Path, text: str, rel: str
) -> tuple[Any, Finding | None, SourceMap]:
    """Like :func:`parse_document`, also returning where every node starts.

    ``rel`` is the name findings and positions report for this file.  A
    parse failure points at the place the parser gave up.
    """
    suffix = path.suffix.lower()
    stripped = text.lstrip()
    as_json = suffix == ".json" or (
        suffix not in {".yaml", ".yml"} and (stripped.startswith("{") or stripped.startswith("["))
    )
    try:
        if as_json:
            value, positions = parse_json_with_positions(text, rel)
        else:
            value, positions = parse_yaml_with_positions(text, rel)
        return value, None, positions
    except Exception as exc:  # noqa: BLE001 — convert parser errors to findings
        return None, Finding(
            code=CF1005_PARSE_ERROR,
            severity=Severity.ERROR,
            message=f"failed to parse {rel}: {exc}",
            subject_kind="document",
            subject_id=rel,
            source=_error_ref(exc, rel),
        ), SourceMap()


def _manifest(root: Path) -> tuple[Any, SourceMap] | None:
    """The workspace manifest and its positions, when the workspace has one."""
    for name in MANIFEST_NAMES:
        candidate = root / name
        if candidate.is_file():
            document, finding, positions = parse_document_with_positions(
                candidate, read_text(candidate), name
            )
            return (document, positions) if finding is None else None
    return None


def _locate_discovery(findings: list[Finding], manifest: tuple[Any, SourceMap] | None) -> list[Finding]:
    """Point findings about ``sources`` entries at the entry in the manifest."""
    if manifest is None:
        return findings
    document, positions = manifest
    entries = document.get("sources") if isinstance(document, dict) else None
    out: list[Finding] = []
    for finding in findings:
        ref: SourceRef | None = None
        if finding.subject_kind == "manifest" and finding.subject_id == "sources":
            ref = positions.value(("sources",))
        elif finding.subject_kind == "manifest" and finding.subject_id is not None:
            ref = positions.value(())
        elif finding.subject_kind == "path" and isinstance(entries, list):
            for index, item in enumerate(entries):
                if str(item) == finding.subject_id:
                    ref = positions.value(("sources", index))
                    break
        out.append(located(finding, ref))
    return out


def _locate_merge(findings: list[Finding], maps: dict[str, SourceMap]) -> list[Finding]:
    """Point merge findings at the later occurrence, in the file that holds it."""
    out: list[Finding] = []
    for finding in findings:
        ref: SourceRef | None = None
        witness = finding.witness
        second = witness.get("second_path") or witness.get("path")
        positions = maps.get(str(second)) if second is not None else None
        if positions is None and finding.subject_kind not in {"document", "field"}:
            positions = maps.get(str(finding.subject_id))
        if positions is not None:
            if finding.code == CF1001_DUPLICATE_ID and finding.subject_kind == "field":
                ref = positions.key((str(finding.subject_id),))
            elif finding.code == CF1001_DUPLICATE_ID:
                ref = positions.key((str(finding.subject_kind), str(finding.subject_id)))
            elif finding.subject_kind == "document":
                ref = positions.value(())
            else:
                ref = positions.key((str(finding.subject_kind),))
        out.append(located(finding, ref))
    return out


def _merged_positions(documents: list[tuple[str, dict[str, Any], SourceMap]]) -> SourceMap:
    """Fold per-file positions into one map whose list indices follow the merge."""
    positions = SourceMap()
    lengths: dict[str, int] = {}
    for _rel, document, file_positions in documents:
        offsets: dict[str, int] = {}
        for key, value in document.items():
            if key in ("cues", "assertions") and isinstance(value, list):
                offsets[key] = lengths.get(key, 0)
                lengths[key] = offsets[key] + len(value)
        positions.absorb(file_positions, offsets)
    return positions


def load_source(root: Path) -> LoadedSource:
    """Load a file or workspace into one mapping, keeping every node's position."""
    if root.is_file():
        rel = posix_relpath(str(root))
        document, parse_finding, positions = parse_document_with_positions(root, read_text(root), rel)
        if parse_finding is not None:
            return LoadedSource(None, [parse_finding], rel, positions)
        if document is None:
            return LoadedSource(
                None,
                [
                    Finding(
                        code=CF1008_EMPTY_DOCUMENT,
                        severity=Severity.ERROR,
                        message=f"empty production document: {root.name}",
                        subject_kind="document",
                        subject_id=root.name,
                    )
                ],
                rel,
                positions,
            )
        if not isinstance(document, dict):
            return LoadedSource(
                None,
                [
                    Finding(
                        code=CF1005_PARSE_ERROR,
                        severity=Severity.ERROR,
                        message="production document must be a mapping",
                        subject_kind="document",
                        subject_id=root.name,
                        source=positions.value(()),
                    )
                ],
                rel,
                positions,
            )
        document.pop("sources", None)
        return LoadedSource(document, [], rel, positions)

    manifest = _manifest(root)
    paths, discover_findings = discover_sources(root)
    findings = _locate_discovery(discover_findings, manifest)
    documents: list[tuple[str, dict[str, Any], SourceMap]] = []
    root_resolved = root.resolve()
    for path in paths:
        rel = path.relative_to(root_resolved).as_posix() if path.is_relative_to(root_resolved) else path.name
        document, parse_finding, positions = parse_document_with_positions(path, read_text(path), rel)
        if parse_finding is not None:
            findings.append(parse_finding)
            continue
        if not isinstance(document, dict):
            findings.append(
                Finding(
                    code=CF1005_PARSE_ERROR,
                    severity=Severity.ERROR,
                    message=f"production document must be a mapping: {path.name}",
                    subject_kind="document",
                    subject_id=path.name,
                    source=positions.value(()),
                )
            )
            continue
        document = dict(document)
        document.pop("sources", None)
        documents.append((rel, document, positions))
    if findings:
        return LoadedSource(None, findings, root.as_posix())
    merged, merge_findings = merge_documents([(rel, document) for rel, document, _ in documents])
    positions = _merged_positions(documents)
    findings.extend(_locate_merge(merge_findings, {rel: file_positions for rel, _, file_positions in documents}))
    if findings:
        return LoadedSource(None, findings, root.as_posix(), positions)
    return LoadedSource(merged, findings, root.as_posix(), positions)
