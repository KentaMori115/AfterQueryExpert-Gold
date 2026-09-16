"""CLI presentation helpers. Honors NO_COLOR and non-TTY output."""

from __future__ import annotations

import os
import sys


def color_enabled(stream: object | None = None) -> bool:
    if os.environ.get("NO_COLOR"):
        return False
    target = stream if stream is not None else sys.stdout
    isatty = getattr(target, "isatty", None)
    return bool(isatty and isatty())


def parse_delay_option(raw: str) -> tuple[str, int]:
    if "=" not in raw:
        raise ValueError("delay must look like CUE=2500ms")
    cue_id, rest = raw.split("=", 1)
    rest = rest.strip().lower()
    if rest.endswith("ms"):
        rest = rest[:-2]
    delay = int(rest, 10)
    return cue_id.strip(), delay
