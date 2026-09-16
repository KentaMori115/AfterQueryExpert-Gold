"""The provider request log.

One append-only JSONL file per run, answering a single question: what did we
ask a provider to generate, and what came back. It records identities, hashes,
sizes and outcomes — never prompts' credentials, never a key, never a header.

The log is written by the generation stages themselves, so a cache hit, a
retry and a fresh paid call are distinguishable after the fact.
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import orjson
from pydantic import ValidationError

from maingott_reel.logging_config import get_logger, redact
from maingott_reel.models import ProviderRequestRecord, RequestOutcome
from maingott_reel.utils.jsonio import dumps

logger = get_logger("utils.request_log")

#: Fields that may carry free text from a provider and are redacted on the way in.
_TEXT_FIELDS = ("detail",)


class RequestLog:
    """Append-only provider request log for one run."""

    def __init__(self, path: Path, run_id: str) -> None:
        """Create a log writing to ``path``."""
        self._path = path
        self._run_id = run_id

    @property
    def path(self) -> Path:
        """Where the log is written."""
        return self._path

    def record(
        self,
        provider: str,
        model: str,
        operation: str,
        outcome: RequestOutcome,
        paid: bool = True,
        **fields: object,
    ) -> ProviderRequestRecord:
        """Append one request record and return it."""
        for name in _TEXT_FIELDS:
            value = fields.get(name)
            if isinstance(value, str):
                fields[name] = redact(value)
        record = ProviderRequestRecord(
            timestamp=datetime.now(tz=UTC),
            run_id=self._run_id,
            provider=provider,
            model=model,
            operation=operation,
            outcome=outcome,
            # A cache hit is never a paid call, whatever the caller believes.
            paid=paid and outcome is not RequestOutcome.CACHE_HIT,
            **fields,
        )
        self._append(record)
        return record

    def _append(self, record: ProviderRequestRecord) -> None:
        """Write one line, creating the log if it does not exist yet."""
        self._path.parent.mkdir(parents=True, exist_ok=True)
        line = orjson.dumps(record.model_dump(mode="json"), default=str)
        with self._path.open("ab") as handle:
            handle.write(line + b"\n")

    def read(self) -> list[ProviderRequestRecord]:
        """Return every record, skipping any line that is not one."""
        if not self._path.is_file():
            return []
        records: list[ProviderRequestRecord] = []
        for line in self._path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                records.append(ProviderRequestRecord.model_validate(orjson.loads(line)))
            except (ValidationError, orjson.JSONDecodeError):
                logger.warning("unreadable line in the provider request log")
        return records

    @property
    def paid_calls(self) -> int:
        """How many recorded requests actually cost money."""
        return sum(
            1
            for record in self.read()
            if record.paid and record.outcome is not RequestOutcome.CACHE_HIT
        )

    def summary(self) -> str:
        """One line describing what this run asked for."""
        records = self.read()
        paid = sum(1 for r in records if r.paid and r.outcome is not RequestOutcome.CACHE_HIT)
        cached = sum(1 for r in records if r.outcome is RequestOutcome.CACHE_HIT)
        failed = sum(1 for r in records if r.outcome is RequestOutcome.FAILED)
        return f"{len(records)} requests: {paid} paid, {cached} from cache, {failed} failed"


def dumps_record(record: ProviderRequestRecord) -> bytes:
    """Serialize one record the same way the log does (used by tests)."""
    return dumps(record.model_dump(mode="json"))
