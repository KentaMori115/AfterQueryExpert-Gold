"""The worked example: Marnstadt, its timetable, and helpers around it.

Import :func:`demo_contents` for the network, :func:`demo_timetable` for it read
through the calendars, and :func:`demo_feed_text` for the same thing written out
as feed tables. The documentation and the command line both use these.
"""

from __future__ import annotations

from datetime import date
from typing import Dict, Optional

from layover.demo.city import (
    DEMO_DATE,
    DEMO_HOLIDAY,
    DEMO_PERIOD,
    DEMO_SATURDAY,
    DEMO_SUNDAY,
    build_demo,
    demo_contents,
)
from layover.feed.writer import feed_to_text, write_feed
from layover.timetable.table import Timetable

__all__ = [
    "DEMO_DATE",
    "DEMO_HOLIDAY",
    "DEMO_PERIOD",
    "DEMO_SATURDAY",
    "DEMO_SUNDAY",
    "build_demo",
    "demo_contents",
    "demo_feed_text",
    "demo_timetable",
    "write_demo_feed",
]


def demo_timetable(days_back: int = 1) -> Timetable:
    """The demo network read through its calendars."""
    contents = demo_contents()
    return Timetable(contents.network, contents.services, days_back)


def demo_feed_text() -> Dict[str, str]:
    """The demo network written out as feed tables, one string each."""
    return feed_to_text(demo_contents())


def write_demo_feed(directory: str) -> tuple[str, ...]:
    """Write the demo network into a directory as a readable feed."""
    return write_feed(demo_contents(), directory)
