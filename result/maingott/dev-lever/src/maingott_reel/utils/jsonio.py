"""Deterministic JSON persistence for Pydantic models."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import orjson
from pydantic import BaseModel

_DUMP_OPTIONS = orjson.OPT_INDENT_2 | orjson.OPT_SORT_KEYS | orjson.OPT_APPEND_NEWLINE


def dumps(data: Any) -> bytes:
    """Serialize ``data`` to stable, human-diffable JSON bytes."""
    return orjson.dumps(data, option=_DUMP_OPTIONS, default=str)


def write_json(path: Path, data: Any) -> Path:
    """Write ``data`` as JSON, creating parent directories."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(dumps(data))
    return path


def write_model(path: Path, model: BaseModel) -> Path:
    """Persist a Pydantic model as JSON."""
    return write_json(path, model.model_dump(mode="json"))


def read_json(path: Path) -> Any:
    """Read a JSON file."""
    return orjson.loads(path.read_bytes())


def read_model[ModelT: BaseModel](path: Path, model_type: type[ModelT]) -> ModelT:
    """Read and validate a persisted Pydantic model."""
    return model_type.model_validate(read_json(path))
