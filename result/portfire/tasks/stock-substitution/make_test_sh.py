#!/usr/bin/env python3
"""Generate tests/test.sh from the frozen frame.

The frame outside the RUN TESTS markers is the platform's, not ours. This
writes only the block between them and asserts every byte above and below is
unchanged before the file is replaced.

    ./make_test_sh.py
"""

from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
FRAME = HERE / "frame_test.sh"
TARGET = HERE / "tests" / "test.sh"
START = "# >>> RUN TESTS (task-specific) <<<\n"
END = "# >>> END RUN TESTS <<<\n"

BLOCK_FILE = HERE / "run_tests.block.sh"
HELD_OUT = HERE / "held-out"
NEW_FILES = ["tests/helpers/expectGuard.ts", "tests/timeline/fromStock.test.ts", "tests/cli/bookFlags.test.ts"]


def block_text() -> str:
    import hashlib
    lines = []
    for rel in NEW_FILES:
        digest = hashlib.sha256((HELD_OUT / rel).read_bytes()).hexdigest()
        lines.append(f"{digest}  {rel}")
    return BLOCK_FILE.read_text().replace("@@SHA@@", "\n".join(lines))


def split(text: str) -> tuple[str, str]:
    start = text.index(START)
    end = text.index(END) + len(END)
    return text[:start], text[end:]


def main() -> int:
    if not FRAME.exists():
        print(f"missing frame: {FRAME}")
        return 1
    head, tail = split(FRAME.read_text())
    generated = head + block_text() + tail
    if TARGET.exists():
        current_head, current_tail = split(TARGET.read_text())
        if (current_head, current_tail) != (head, tail):
            print("REFUSING: tests/test.sh has drifted outside the RUN TESTS markers")
            return 1
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(generated)
    TARGET.chmod(0o755)
    written_head, written_tail = split(TARGET.read_text())
    assert (written_head, written_tail) == (head, tail), "frame moved while writing"
    print(f"wrote {TARGET} ({len(generated)} bytes); frame byte-identical")
    return 0


if __name__ == "__main__":
    sys.exit(main())
