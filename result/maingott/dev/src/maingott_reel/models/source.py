"""Source document and fact registry schemas."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

from pydantic import Field, field_validator, model_validator

from maingott_reel.models.base import (
    SCHEMA_VERSION,
    BlockType,
    ClaimStatus,
    FactCategory,
    Schema,
)


class SourceBlock(Schema):
    """One extracted block of text from the specification.

    Blocks are emitted in document order. ``line`` is the 1-based position of
    the block in that order and is what :class:`Fact` references, because DOCX
    files do not carry reliable page or line information on their own.
    """

    index: int = Field(ge=0, description="Zero-based position in the document")
    line: int = Field(ge=1, description="1-based line number in the flattened document")
    text: str = Field(min_length=1)
    block_type: BlockType = BlockType.PARAGRAPH
    style: str | None = Field(default=None, description="Original paragraph/heading style")
    heading_level: int | None = Field(default=None, ge=1, le=9)
    section: str | None = Field(default=None, description="Nearest preceding level-1 heading")
    subsection: str | None = Field(default=None, description="Nearest preceding level-2 heading")
    page: int | None = Field(
        default=None, ge=1, description="Page number, only when the file records pagination"
    )
    table_index: int | None = Field(default=None, ge=0)
    row_index: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def _table_fields_are_consistent(self) -> SourceBlock:
        is_table_row = self.block_type is BlockType.TABLE_ROW
        has_table_fields = self.table_index is not None and self.row_index is not None
        if is_table_row != has_table_fields:
            raise ValueError("table_index and row_index are required exactly for table rows")
        return self


class SourceDocument(Schema):
    """The parsed MainGott specification."""

    schema_version: int = SCHEMA_VERSION
    path: Path
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    extracted_at: datetime
    block_count: int = Field(ge=0)
    paragraph_count: int = Field(default=0, ge=0)
    table_count: int = Field(default=0, ge=0)
    has_pagination: bool = Field(
        default=False, description="Whether the file recorded rendered page breaks"
    )
    blocks: list[SourceBlock] = Field(default_factory=list)

    @model_validator(mode="after")
    def _check_block_count(self) -> SourceDocument:
        if self.blocks and self.block_count != len(self.blocks):
            raise ValueError("block_count does not match the number of blocks")
        return self

    def text(self) -> str:
        """Return the flattened document text, one block per line."""
        return "\n".join(block.text for block in self.blocks)

    def sections(self) -> list[str]:
        """Return the level-1 section titles in document order."""
        titles: list[str] = []
        for block in self.blocks:
            is_section = block.block_type is BlockType.HEADING and block.heading_level == 1
            if is_section and block.text not in titles:
                titles.append(block.text)
        return titles


class Fact(Schema):
    """A single verifiable statement taken from the specification.

    ``statement`` is copied verbatim from the source: the claims policy allows
    an advertisement to rest only on what the specification actually says.
    """

    id: str = Field(pattern=r"^F-\d{3,}$", description="Stable identifier such as F-001")
    statement: str = Field(min_length=3)
    category: FactCategory = FactCategory.OTHER
    claim_status: ClaimStatus = ClaimStatus.SUPPORTED
    source_page: int | None = Field(default=None, ge=1)
    source_lines: list[int] = Field(default_factory=list)
    source_quote: str | None = None
    section: str | None = None
    notes: str | None = None

    @field_validator("source_lines")
    @classmethod
    def _lines_are_positive(cls, value: list[int]) -> list[int]:
        if any(line < 0 for line in value):
            raise ValueError("source_lines must not contain negative values")
        return value

    @property
    def usable_in_advertising(self) -> bool:
        """Unsupported claims must never reach the final Reel."""
        return self.claim_status is not ClaimStatus.UNSUPPORTED


class FactRegistry(Schema):
    """All facts extracted from one source document."""

    schema_version: int = SCHEMA_VERSION
    source_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    created_at: datetime
    facts: list[Fact] = Field(default_factory=list)

    @model_validator(mode="after")
    def _unique_ids(self) -> FactRegistry:
        ids = [fact.id for fact in self.facts]
        duplicates = {fact_id for fact_id in ids if ids.count(fact_id) > 1}
        if duplicates:
            raise ValueError(f"duplicate fact ids: {sorted(duplicates)}")
        return self

    def get(self, fact_id: str) -> Fact | None:
        """Return the fact with ``fact_id`` if present."""
        return next((fact for fact in self.facts if fact.id == fact_id), None)

    def unknown_ids(self, fact_ids: list[str]) -> list[str]:
        """Return the ids that are not part of this registry."""
        known = {fact.id for fact in self.facts}
        return [fact_id for fact_id in fact_ids if fact_id not in known]

    def by_category(self, category: FactCategory) -> list[Fact]:
        """Return every fact in ``category``."""
        return [fact for fact in self.facts if fact.category is category]

    def by_status(self, status: ClaimStatus) -> list[Fact]:
        """Return every fact with claim status ``status``."""
        return [fact for fact in self.facts if fact.claim_status is status]

    def category_counts(self) -> dict[str, int]:
        """Return fact counts per category, for run summaries and logs."""
        counts: dict[str, int] = {}
        for fact in self.facts:
            counts[fact.category.value] = counts.get(fact.category.value, 0) + 1
        return dict(sorted(counts.items()))
