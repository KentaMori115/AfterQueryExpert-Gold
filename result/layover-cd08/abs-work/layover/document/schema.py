"""The shape of a saved network, and which version of it this is.

A document is plain JSON: dictionaries, lists, strings and whole numbers. No
floats, because a saved feed has to read back byte for byte the same, and no
objects that only Python understands, because a document outlives the process
that wrote it.
"""

from __future__ import annotations

from typing import Any, Dict, Iterable

from layover.errors import DocumentError

__all__ = [
    "FORMAT",
    "SECTIONS",
    "VERSION",
    "check_document",
    "empty_document",
    "section",
    "version_of",
]

FORMAT = "layover-network"
VERSION = 3

SECTIONS = (
    "agencies",
    "stops",
    "routes",
    "patterns",
    "trips",
    "transfers",
    "calendars",
)


def empty_document(name: str = "") -> Dict[str, Any]:
    """A document with every section present and nothing in it."""
    document: Dict[str, Any] = {"format": FORMAT, "version": VERSION, "name": name}
    for section in SECTIONS:
        document[section] = []
    document["fares"] = None
    return document


def version_of(document: Any) -> int:
    """The version a document says it is, checking the format tag on the way."""
    if not isinstance(document, dict):
        raise DocumentError("a document is a mapping, got %s" % type(document).__name__)
    if document.get("format") != FORMAT:
        raise DocumentError("this is not a %s document" % FORMAT)
    version = document.get("version")
    if not isinstance(version, int) or isinstance(version, bool):
        raise DocumentError("a document version is a whole number, got %r" % (version,))
    if version < 1 or version > VERSION:
        raise DocumentError("unknown document version: %d" % version)
    return version


def check_document(document: Any) -> None:
    """Raise unless the document is current and has every section it should."""
    version = version_of(document)
    if version != VERSION:
        raise DocumentError(
            "this document is version %d and the current version is %d" % (version, VERSION)
        )
    for section in SECTIONS:
        value = document.get(section)
        if not isinstance(value, list):
            raise DocumentError("section %r is missing or is not a list" % section)
    fares = document.get("fares", None)
    if fares is not None and not isinstance(fares, dict):
        raise DocumentError("the fares section is neither absent nor a mapping")


def section(document: Dict[str, Any], name: str) -> Iterable[Dict[str, Any]]:
    """Return one section of a document, checking that it holds mappings."""
    rows = document.get(name, [])
    if not isinstance(rows, list):
        raise DocumentError("section %r is not a list" % name)
    for row in rows:
        if not isinstance(row, dict):
            raise DocumentError("section %r holds something that is not a mapping" % name)
    return rows
