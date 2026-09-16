"""Reading and writing documents as files on disk."""

from __future__ import annotations

import json
import os
from typing import Any, Dict

from layover.document.digest import canonical_json, digest_of
from layover.document.read import from_document
from layover.document.write import to_document
from layover.errors import DocumentError

__all__ = [
    "document_digest",
    "load_document",
    "read_document",
    "save_document",
    "write_document",
]


def write_document(document: Dict[str, Any], path: str, indent: int = 2) -> str:
    """Write a document as JSON, checking it holds nothing unserialisable."""
    canonical_json(document)
    directory = os.path.dirname(os.path.abspath(path))
    os.makedirs(directory, exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(document, handle, ensure_ascii=False, indent=indent, sort_keys=True)
        handle.write("\n")
    return path


def read_document(path: str) -> Dict[str, Any]:
    """Read a document from JSON, saying where it failed if it is not one."""
    if not os.path.isfile(path):
        raise DocumentError("no such document: %s" % path)
    with open(path, "r", encoding="utf-8") as handle:
        try:
            document = json.load(handle)
        except ValueError as problem:
            raise DocumentError("%s is not JSON: %s" % (path, problem)) from None
    if not isinstance(document, dict):
        raise DocumentError("%s does not hold a document" % path)
    return document


def save_document(contents, path: str) -> str:
    """Save a loaded feed straight to a file."""
    return write_document(to_document(contents), path)


def load_document(path: str, name: str = ""):
    """Load a feed straight from a file, migrating it if it is older."""
    return from_document(read_document(path), name)


def document_digest(contents) -> str:
    """The digest of what a feed would be saved as."""
    return digest_of(to_document(contents))
