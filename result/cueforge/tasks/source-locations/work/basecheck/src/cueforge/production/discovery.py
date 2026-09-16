"""Discover production sources from a file or workspace directory."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from cueforge.codes import CF1003_PATH_ESCAPE, CF1005_PARSE_ERROR, CF1008_EMPTY_DOCUMENT
from cueforge.findings import Finding, Severity
from cueforge.production.json_loader import parse_json_text
from cueforge.production.merge import merge_documents
from cueforge.production.source_map import is_path_escape, posix_relpath
from cueforge.production.yaml_loader import parse_yaml_text

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
