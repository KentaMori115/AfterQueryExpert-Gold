"""DOCX reading.

The reader walks the document body in true document order so paragraphs and
tables keep their relative position, and records the structural context
(section, subsection, list membership, table coordinates) that later stages
need to trace an advertising claim back to the specification.

DOCX files do not store page numbers. Pages are reported only when the file
contains Word's rendered page-break markers; otherwise ``page`` stays ``None``
and blocks are addressed by their 1-based ``line`` number instead.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from docx import Document
from docx.document import Document as DocxDocument
from docx.oxml.ns import qn
from docx.table import Table
from docx.text.paragraph import Paragraph

from maingott_reel.errors import SourceError
from maingott_reel.logging_config import get_logger
from maingott_reel.models import BlockType, SourceBlock, SourceDocument
from maingott_reel.utils.hashing import sha256_file

logger = get_logger("source.docx")

#: Heading style prefixes, English and Russian localisations of Word.
_HEADING_PREFIXES = ("heading", "заголовок")

#: List style prefixes. Word marks list items either by style or by numbering.
_LIST_STYLE_PREFIXES = ("list", "список", "абзац списка")

_WHITESPACE = re.compile(r"[\s\u00a0]+")
_HEADING_LEVEL = re.compile(r"(\d+)\s*$")


def normalize_text(value: str) -> str:
    """Collapse whitespace and normalise unicode punctuation."""
    text = unicodedata.normalize("NFKC", value).replace("\u00a0", " ")
    return _WHITESPACE.sub(" ", text).strip()


def iter_block_items(document: DocxDocument) -> Iterator[Paragraph | Table]:
    """Yield paragraphs and tables of ``document`` in document order."""
    body = document.element.body
    for child in body.iterchildren():
        if child.tag == qn("w:p"):
            yield Paragraph(child, document)
        elif child.tag == qn("w:tbl"):
            yield Table(child, document)


def heading_level(style_name: str | None) -> int | None:
    """Return the heading level of a paragraph style, if it is a heading."""
    if not style_name:
        return None
    lowered = style_name.strip().lower()
    if not lowered.startswith(_HEADING_PREFIXES):
        return None
    match = _HEADING_LEVEL.search(lowered)
    return int(match.group(1)) if match else 1


def is_list_paragraph(paragraph: Paragraph) -> bool:
    """Whether the paragraph is a list item.

    Word marks lists either with numbering properties (the real specification)
    or with a list paragraph style, so both are checked.
    """
    properties = paragraph._p.pPr  # python-docx exposes no public accessor
    if properties is not None and properties.numPr is not None:
        return True
    style: str | None = paragraph.style.name if paragraph.style is not None else None
    if style is None:
        return False
    return style.strip().lower().startswith(_LIST_STYLE_PREFIXES)


def _has_rendered_pagination(document: DocxDocument) -> bool:
    """Whether Word stored rendered page breaks we can trust for page numbers."""
    return bool(document.element.body.findall(f".//{qn('w:lastRenderedPageBreak')}"))


def _page_breaks_in(element: Any) -> int:
    """Count rendered page breaks inside a block element."""
    return len(element.findall(f".//{qn('w:lastRenderedPageBreak')}"))


def _row_text(row: Any) -> str:
    """Join the non-empty cells of a table row."""
    seen: list[str] = []
    for cell in row.cells:
        text = normalize_text(cell.text)
        # Merged cells repeat their content across the span.
        if text and (not seen or seen[-1] != text):
            seen.append(text)
    return " — ".join(seen)


def read_docx(path: Path) -> SourceDocument:
    """Read a DOCX specification into a :class:`SourceDocument`.

    Raises:
        SourceError: the file is missing, is not a DOCX or cannot be parsed.
    """
    if not path.is_file():
        raise SourceError(f"Source document not found: {path}")
    if path.suffix.lower() != ".docx":
        raise SourceError(f"Source document must be a .docx file, got: {path.name}")

    try:
        document = Document(str(path))
    except Exception as error:  # python-docx raises many low-level types
        raise SourceError(f"Could not read {path.name}: {error}") from error

    has_pagination = _has_rendered_pagination(document)
    blocks: list[SourceBlock] = []
    section: str | None = None
    subsection: str | None = None
    paragraph_count = 0
    table_count = 0
    table_index = -1
    page = 1

    for item in iter_block_items(document):
        if isinstance(item, Paragraph):
            page += _page_breaks_in(item._p)  # raw element access
            text = normalize_text(item.text)
            if not text:
                continue
            paragraph_count += 1
            style = item.style.name if item.style is not None else None
            level = heading_level(style)
            if level is not None:
                block_type = BlockType.HEADING
                if level == 1:
                    section, subsection = text, None
                elif level == 2:
                    subsection = text
            elif is_list_paragraph(item):
                block_type = BlockType.LIST_ITEM
            else:
                block_type = BlockType.PARAGRAPH

            blocks.append(
                SourceBlock(
                    index=len(blocks),
                    line=len(blocks) + 1,
                    text=text,
                    block_type=block_type,
                    style=style,
                    heading_level=level,
                    section=section,
                    subsection=subsection,
                    page=page if has_pagination else None,
                )
            )
        else:
            page += _page_breaks_in(item._tbl)  # raw element access
            table_index += 1
            table_count += 1
            for row_index, row in enumerate(item.rows):
                text = _row_text(row)
                if not text:
                    continue
                blocks.append(
                    SourceBlock(
                        index=len(blocks),
                        line=len(blocks) + 1,
                        text=text,
                        block_type=BlockType.TABLE_ROW,
                        section=section,
                        subsection=subsection,
                        page=page if has_pagination else None,
                        table_index=table_index,
                        row_index=row_index,
                    )
                )

    source = SourceDocument(
        path=path,
        sha256=sha256_file(path),
        extracted_at=datetime.now(tz=UTC),
        block_count=len(blocks),
        paragraph_count=paragraph_count,
        table_count=table_count,
        has_pagination=has_pagination,
        blocks=blocks,
    )
    logger.info(
        "source document read",
        extra={
            "source": str(path),
            "blocks": source.block_count,
            "paragraphs": paragraph_count,
            "tables": table_count,
            "has_pagination": has_pagination,
        },
    )
    return source
