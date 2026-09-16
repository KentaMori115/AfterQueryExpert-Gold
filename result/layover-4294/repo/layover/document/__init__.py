"""The saved form of a network: one JSON document, versioned and migrated.

A document is what a feed becomes once it has been read: the same content, but
in one file, with the times already parsed. Older versions are migrated on the
way in, so a document written last year still loads.
"""

from __future__ import annotations

from layover.document.digest import canonical_json, check_no_floats, digest_of, short_digest
from layover.document.migrate import MIGRATIONS, migrate, migration_path
from layover.document.read import from_document
from layover.document.schema import FORMAT, SECTIONS, VERSION, check_document, empty_document
from layover.document.store import (
    document_digest,
    load_document,
    read_document,
    save_document,
    write_document,
)
from layover.document.write import to_document

__all__ = [
    "FORMAT",
    "MIGRATIONS",
    "SECTIONS",
    "VERSION",
    "canonical_json",
    "check_document",
    "check_no_floats",
    "digest_of",
    "document_digest",
    "empty_document",
    "from_document",
    "load_document",
    "migrate",
    "migration_path",
    "read_document",
    "save_document",
    "short_digest",
    "to_document",
    "write_document",
]
