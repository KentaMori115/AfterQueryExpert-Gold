"""Writing and reading the interchange file.

JSON, sorted keys, two space indent, one trailing newline. None of that is an
aesthetic choice: it is so that the file can be kept in version control and a
change to it can be reviewed line by line like any other change.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from ..errors import SignalboxError
from ..signalling.interlocking import Interlocking
from ..topology.scheme import Scheme
from .migrate import migrate, needs_migrating
from .model import SCHEMA_VERSION, as_dict
from .schema import problems

INDENT = 2
SUFFIX = ".sbj"


class InterchangeError(SignalboxError):
    """The file is not an interchange file, or is one this version cannot read."""


def dumps(scheme: Scheme, interlocking: Interlocking) -> str:
    """The interchange file as text."""
    return to_text(as_dict(scheme, interlocking))


def to_text(data: dict[str, Any]) -> str:
    return json.dumps(data, indent=INDENT, sort_keys=True, ensure_ascii=False) + "\n"


def loads(text: str) -> dict[str, Any]:
    """Read an interchange file, checking that it is one."""
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise InterchangeError(f"not valid JSON: {exc.msg} at line {exc.lineno}") from None
    if not isinstance(data, dict):
        raise InterchangeError("an interchange file holds an object at the top level")
    schema = data.get("schema")
    if schema is None:
        raise InterchangeError("no schema version, this is not an interchange file")
    if schema > SCHEMA_VERSION:
        raise InterchangeError(
            f"written by a later version (schema {schema}, this reads {SCHEMA_VERSION})"
        )
    if needs_migrating(data):
        try:
            data = migrate(data)
        except (KeyError, RuntimeError) as exc:
            raise InterchangeError(str(exc).strip("'")) from None
    if "scheme" not in data:
        raise InterchangeError("no scheme in the file")
    found = list(problems(data))
    if found:
        raise InterchangeError(found[0])
    checked: dict[str, Any] = data
    return checked


def write(path: str | Path, scheme: Scheme, interlocking: Interlocking) -> int:
    """Write the interchange file, returning how many bytes went out."""
    text = dumps(scheme, interlocking)
    target = Path(path)
    try:
        target.write_text(text, encoding="utf-8")
    except OSError as exc:
        raise InterchangeError(f"cannot write {target}: {exc.strerror}") from None
    return len(text)


def read(path: str | Path) -> dict[str, Any]:
    source = Path(path)
    try:
        text = source.read_text(encoding="utf-8")
    except OSError as exc:
        raise InterchangeError(f"cannot read {source}: {exc.strerror}") from None
    return loads(text)


def fingerprint(data: dict[str, Any]) -> str:
    """A short hash of the data, for quoting on a drawing or in an email."""
    digest = hashlib.sha256(to_text(data).encode("utf-8")).hexdigest()
    return digest[:12]


def route_names(data: dict[str, Any]) -> list[str]:
    return [route["name"] for route in data.get("routes", [])]
