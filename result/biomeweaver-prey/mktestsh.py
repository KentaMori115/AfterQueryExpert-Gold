#!/usr/bin/env python3
"""Regenerate tests/test.sh from the frozen frame.

The frame is the file the platform handed us in the draft. Only the block
between the RUN TESTS markers is ours; this script rewrites that block and
asserts every byte outside the markers is unchanged.
"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
FRAME = HERE / 'frame' / 'test.sh'
OUT = HERE / 'tasks' / 'prey-competition' / 'tests' / 'test.sh'

START = '# >>> RUN TESTS (task-specific) <<<'
END = '# >>> END RUN TESTS <<<'

HARNESS = HERE / 'harness'


def block() -> str:
    """The task-specific block: a shell template with the harness spliced in."""
    text = (HARNESS / 'block.template.sh').read_text()
    for name, marker in (
        ('shim.mjs', '__SHIM__'),
        ('hooks.mjs', '__HOOKS__'),
        ('run.mjs', '__RUN__'),
        ('publish.py', '__PUBLISH__'),
    ):
        source = (HARNESS / name).read_text()
        if marker in source:
            raise SystemExit(f'{name} carries the heredoc marker {marker}')
        anchor = f"<<'{marker}'\n{marker}"
        if anchor not in text:
            raise SystemExit(f'no slot for {name} in the template')
        text = text.replace(anchor, f"<<'{marker}'\n{source}{marker}")
    return text


BLOCK = block()


def main() -> int:
    frame = FRAME.read_text()
    head, rest = frame.split(START, 1)
    _, tail = rest.split(END, 1)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(head + START + BLOCK + END + tail)

    written = OUT.read_text()
    w_head, w_rest = written.split(START, 1)
    _, w_tail = w_rest.split(END, 1)
    if w_head != head or w_tail != tail:
        print('FRAME MOVED', file=sys.stderr)
        return 1
    print(f'wrote {OUT} ({len(written.splitlines())} lines), frame intact')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
