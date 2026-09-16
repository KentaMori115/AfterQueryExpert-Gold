"""Make the working tree importable no matter how pytest is invoked.

``python -m pytest`` puts the current directory on ``sys.path`` for free, but a
bare ``pytest`` does not, so the suite would fail to import ``slateql`` unless
the package happened to be installed. Prepending the repository root here keeps
both invocations working, and keeps a checked-out working tree ahead of any
installed copy of the same package.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent

if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
