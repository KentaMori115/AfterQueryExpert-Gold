"""Small dependency-free helpers shared across the engine."""

from .iterables import batched, dedupe, first, flatten, partition
from .ordering import SortKey, compare_values, null_safe_key
from .table_render import render_table
from .text import indent_block, plural, quote_identifier, suggest, truncate
from .timing import Stopwatch, format_duration

__all__ = [
    "batched",
    "dedupe",
    "first",
    "flatten",
    "partition",
    "SortKey",
    "compare_values",
    "null_safe_key",
    "indent_block",
    "plural",
    "quote_identifier",
    "suggest",
    "truncate",
    "Stopwatch",
    "format_duration",
    "render_table",
]
