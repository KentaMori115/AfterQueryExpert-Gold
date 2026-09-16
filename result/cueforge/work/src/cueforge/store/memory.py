"""In-memory run store for tests."""

from __future__ import annotations

from cueforge.codes import CF8003_MISSING_RUN
from cueforge.findings import Finding, Severity
from cueforge.reports.canonical_json import canonical_dumps
from cueforge.result import Result
from cueforge.store.integrity import cache_conflict, hash_text
from cueforge.store.protocol import RunRecord


class MemoryRunStore:
    def __init__(self) -> None:
        self._records: dict[str, RunRecord] = {}

    def put(self, record: RunRecord) -> Result[RunRecord]:
        existing = self._records.get(record.digest)
        if existing is not None:
            if canonical_dumps(dict(existing.payload)) != canonical_dumps(dict(record.payload)):
                return Result.fail([cache_conflict(record.digest)])
            return Result.ok(existing)
        artifacts = dict(record.artifacts)
        if "payload" not in artifacts:
            artifacts["payload"] = hash_text(canonical_dumps(dict(record.payload)))
        stored = RunRecord(record.digest, record.kind, dict(record.payload), artifacts)
        self._records[record.digest] = stored
        return Result.ok(stored)

    def get(self, digest: str) -> Result[RunRecord]:
        record = self._records.get(digest)
        if record is None:
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
        expected = hash_text(canonical_dumps(dict(record.payload)))
        actual = record.artifacts.get("payload")
        if actual is not None and actual != expected:
            from cueforge.store.integrity import integrity_error

            return Result.fail([integrity_error(digest, "payload hash mismatch")])
        return Result.ok(record)
