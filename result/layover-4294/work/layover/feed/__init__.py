"""The feed format: comma separated tables in, network and calendars out.

Read a directory with :func:`read_directory`, or a mapping of table name to text
with :meth:`RawFeed.of_text`, then :func:`load_feed` to get a
:class:`FeedContents`. :func:`write_feed` puts one back on disk in a form that
reads again unchanged.
"""

from __future__ import annotations

from layover.feed.load import FeedContents, load_feed, load_with_problems
from layover.feed.parse import Problems
from layover.feed.reader import RawFeed, RawRow, RawTable, read_directory, read_text
from layover.feed.tables import REQUIRED_TABLES, TABLES, Column, Table, table_named, table_names
from layover.feed.writer import feed_to_text, write_feed, write_table

__all__ = [
    "Column",
    "FeedContents",
    "Problems",
    "REQUIRED_TABLES",
    "RawFeed",
    "RawRow",
    "RawTable",
    "TABLES",
    "Table",
    "feed_to_text",
    "load_feed",
    "load_with_problems",
    "read_directory",
    "read_text",
    "table_named",
    "table_names",
    "write_feed",
    "write_table",
]
