"""Run-store protocol and record type."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping, Protocol

from cueforge.findings import Finding
from cueforge.result import Result


@dataclass(frozen=True, slots=True)
class RunRecord:
    digest: str
    kind: str
    payload: Mapping[str, object]
    artifacts: Mapping[str, str]


class RunStore(Protocol):
    def put(self, record: RunRecord) -> Result[RunRecord]:
        ...

    def get(self, digest: str) -> Result[RunRecord]:
        ...
