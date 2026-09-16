"""Disk run store under .cueforge/runs/<digest>/."""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

from cueforge.codes import CF8003_MISSING_RUN, CF8004_STORE_IO
from cueforge.findings import Finding, Severity
from cueforge.reports.canonical_json import canonical_dumps
from cueforge.result import Result
from cueforge.store.integrity import cache_conflict, hash_bytes, hash_text, integrity_error
from cueforge.store.protocol import RunRecord


class DiskRunStore:
    def __init__(self, root: Path) -> None:
        self.root = root

    def _run_dir(self, digest: str) -> Path:
        return self.root / ".cueforge" / "runs" / digest

    def put(self, record: RunRecord) -> Result[RunRecord]:
        dest = self._run_dir(record.digest)
        payload_text = canonical_dumps(dict(record.payload))
        manifest = {
            "artifacts": {"payload.json": hash_text(payload_text)},
            "digest": record.digest,
            "kind": record.kind,
        }
        manifest_text = canonical_dumps(manifest)
        if dest.is_dir():
            existing = dest / "payload.json"
            if existing.is_file() and existing.read_text(encoding="utf-8") != payload_text:
                return Result.fail([cache_conflict(record.digest)])
            return self.get(record.digest)
        parent = dest.parent
        try:
            parent.mkdir(parents=True, exist_ok=True)
            tmp = Path(tempfile.mkdtemp(prefix=f".{record.digest}.", dir=parent))
            (tmp / "payload.json").write_bytes(payload_text.encode("utf-8"))
            (tmp / "manifest.json").write_bytes(manifest_text.encode("utf-8"))
            os.replace(tmp, dest)
        except OSError as exc:
            return Result.fail(
                [
                    Finding(
                        code=CF8004_STORE_IO,
                        severity=Severity.ERROR,
                        message=f"failed to write run {record.digest}: {exc}",
                        subject_kind="run",
                        subject_id=record.digest,
                    )
                ]
            )
        return self.get(record.digest)

    def get(self, digest: str) -> Result[RunRecord]:
        dest = self._run_dir(digest)
        manifest_path = dest / "manifest.json"
        payload_path = dest / "payload.json"
        if not manifest_path.is_file() or not payload_path.is_file():
            return Result.fail(
                [
                    Finding(
                        code=CF8003_MISSING_RUN,
                        severity=Severity.ERROR,
                        message=f"run {digest} is not stored",
                        subject_kind="run",
                        subject_id=digest,
                    )
                ]
            )
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            payload_bytes = payload_path.read_bytes()
        except OSError as exc:
            return Result.fail(
                [
                    Finding(
                        code=CF8004_STORE_IO,
                        severity=Severity.ERROR,
                        message=f"failed to read run {digest}: {exc}",
                        subject_kind="run",
                        subject_id=digest,
                    )
                ]
            )
        expected = manifest.get("artifacts", {}).get("payload.json")
        actual = hash_bytes(payload_bytes)
        if expected != actual:
            return Result.fail([integrity_error(digest, "payload.json hash mismatch")])
        payload = json.loads(payload_bytes.decode("utf-8"))
        return Result.ok(
            RunRecord(
                digest=digest,
                kind=str(manifest.get("kind", "unknown")),
                payload=payload,
                artifacts=dict(manifest.get("artifacts", {})),
            )
        )
