#!/usr/bin/env python3
"""Generate tests/test.sh from the frozen frame.

The frame outside the RUN TESTS markers is the platform's, not ours. This
writes only the block between them and asserts every byte above and below is
unchanged before the file is replaced.

    ./make_test_sh.py
"""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
FRAME = HERE / "frame_test.sh"
TARGET = HERE / "tests" / "test.sh"
START = "# >>> RUN TESTS (task-specific) <<<\n"
END = "# >>> END RUN TESTS <<<\n"

BLOCK_FILE = HERE / "run_tests.block.sh"
VERIFIER = HERE / "verifier"
HELD_OUT = HERE / "held-out"
BASE_REPO = HERE.parent.parent / "repo"

P2P_FILES = [
    "tests/test_offline.py",
    "tests/test_schwab_api.py",
    "tests/test_server_api.py",
    "tests/test_user_allow.py",
    "Users/tests.py",
    "tests/__init__.py",
]
NEW_FILES = [
    "tests/test_risk_budget.py",
    "tests/test_risk_budget_admin.py",
]


def digests(root: Path, names: list[str]) -> str:
    lines = []
    for rel in names:
        digest = hashlib.sha256((root / rel).read_bytes()).hexdigest()
        lines.append(f"{digest}  {rel}")
    return "\n".join(lines)


def heredoc(name: str, path: Path) -> str:
    """The python file, written into $VDIR by the block itself."""
    marker = name.upper()
    body = path.read_text()
    return f'cat > "$VDIR/{name}.py" <<\'PY{marker}\'\n{body}PY{marker}\n'


def block_text() -> str:
    text = BLOCK_FILE.read_text()
    text = text.replace("@@CHILD@@\n", heredoc("child", VERIFIER / "child.py"))
    text = text.replace("@@PUBLISH@@\n", heredoc("publish", VERIFIER / "publish.py"))
    text = text.replace("@@SHA_P2P@@", digests(BASE_REPO, P2P_FILES))
    text = text.replace("@@SHA_NEW@@", digests(HELD_OUT, NEW_FILES))
    return text


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
