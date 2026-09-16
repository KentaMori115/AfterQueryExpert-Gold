"""JSON loader that captures numeric tokens as decimal text."""

from __future__ import annotations

import json
from typing import Any


def parse_json_text(text: str) -> Any:
    return json.loads(text, parse_float=lambda token: token, parse_int=lambda token: token)
