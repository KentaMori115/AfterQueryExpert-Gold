"""The ``analyze`` stage.

Reads the MainGott specification, hashes it, builds the fact registry and
persists both into the run directory. The stage is deterministic and makes no
provider calls: re-running it on an unchanged document reuses the existing
artifacts unless ``force`` is set.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import orjson
from pydantic import ValidationError

from maingott_reel.config import Settings
from maingott_reel.errors import SourceError
from maingott_reel.logging_config import get_logger
from maingott_reel.models import FactRegistry, SourceDocument, StageName
from maingott_reel.source.docx_reader import read_docx
from maingott_reel.source.fact_registry import extract_facts
from maingott_reel.utils.hashing import sha256_file
from maingott_reel.utils.jsonio import read_model, write_model
from maingott_reel.utils.manifest_store import load_or_create_manifest, save_manifest
from maingott_reel.utils.run_context import RunContext, create_run

logger = get_logger("source.analyzer")


@dataclass(frozen=True)
class AnalysisResult:
    """What the ``analyze`` stage produced."""

    run: RunContext
    source: SourceDocument
    registry: FactRegistry
    reused: bool

    @property
    def fact_count(self) -> int:
        """Number of facts in the registry."""
        return len(self.registry.facts)


def _reusable(run: RunContext, source_sha256: str) -> tuple[SourceDocument, FactRegistry] | None:
    """Return existing artifacts when they already describe this exact source."""
    if not (run.source_json.is_file() and run.facts_json.is_file()):
        return None
    try:
        source = read_model(run.source_json, SourceDocument)
        registry = read_model(run.facts_json, FactRegistry)
    except (ValidationError, orjson.JSONDecodeError, OSError) as error:
        # A partially written or outdated run directory must not block a re-run.
        logger.warning("existing analysis is unreadable, regenerating", extra={"error": str(error)})
        return None
    if source.sha256 != source_sha256 or registry.source_sha256 != source_sha256:
        return None
    return source, registry


def analyze(
    settings: Settings,
    run_id: str | None = None,
    source_path: Path | None = None,
    force: bool = False,
    on_run_created: Callable[[RunContext], None] | None = None,
) -> AnalysisResult:
    """Run the source analysis stage.

    Args:
        settings: effective configuration.
        run_id: run directory to use. A new run is created when omitted.
        source_path: overrides ``settings.source_document``.
        force: re-extract even when the run already analysed this document.
        on_run_created: called with the run as soon as its directory exists,
            so the caller can start writing the run log before work begins.

    Raises:
        SourceError: the specification is missing or unreadable.
    """
    path = source_path or settings.source_document
    if not path.is_file():
        raise SourceError(
            f"Source document not found: {path}. "
            "Put the MainGott specification in input/source/ or pass --source."
        )

    run = create_run(settings, run_id=run_id)
    if on_run_created is not None:
        on_run_created(run)
    source_sha256 = sha256_file(path)

    if not force:
        cached = _reusable(run, source_sha256)
        if cached is not None:
            source, registry = cached
            logger.info(
                "analysis reused",
                extra={"run_id": run.run_id, "facts": len(registry.facts)},
            )
            return AnalysisResult(run=run, source=source, registry=registry, reused=True)

    source = read_docx(path)
    registry = extract_facts(source)
    write_model(run.source_json, source)
    write_model(run.facts_json, registry)

    manifest = load_or_create_manifest(run)
    manifest.source_path = path
    manifest.source_sha256 = source.sha256
    manifest.files["source"] = run.source_json
    manifest.files["facts"] = run.facts_json
    manifest.record_stage(
        StageName.ANALYZE,
        completed_at=datetime.now(tz=UTC),
        artifact=run.facts_json,
        notes=f"{len(registry.facts)} facts from {source.block_count} blocks",
    )
    save_manifest(run, manifest)

    logger.info(
        "analysis complete",
        extra={
            "run_id": run.run_id,
            "blocks": source.block_count,
            "facts": len(registry.facts),
            "source_sha256": source.sha256,
        },
    )
    return AnalysisResult(run=run, source=source, registry=registry, reused=False)
