#!/usr/bin/env python3
"""Fill the only two fields of task.toml that are ours to write.

Everything else in the file is generated when the draft is created, and a
task.toml rebuilt by hand wipes the frame and fails every toml rule at once. So
this reads the pulled file, rewrites exactly two lines, and refuses to write
anything if a third line moved.

    ./set_display.py draft/task.toml push/task.toml
"""
import re
import sys
from pathlib import Path

TITLE = "Ration contested prey between the predators that hunt it"
DESCRIPTION = (
    "Predation is settled one predator cohort at a time off a running prey count, so the "
    "first cohort in sort order empties a contested prey cohort and every later one goes "
    "without. Settle a whole tick together: asks read before anything moves, an authored "
    "per-species intake cap, an optional saturation on a rule, and prey shared out in "
    "proportion round by round until a round moves nothing."
)

FIELDS = {"display_title": TITLE, "display_description": DESCRIPTION}


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__)
        return 1
    source, target = Path(argv[0]), Path(argv[1])
    if not source.exists():
        print(f"no such file: {source}")
        return 1
    lines = source.read_text().splitlines(keepends=True)
    written = []
    seen = set()
    for line in lines:
        found = re.match(r'^(\s*)(display_title|display_description)\s*=\s*', line)
        if found:
            value = FIELDS[found.group(2)].replace('"', "'")
            written.append(f'{found.group(1)}{found.group(2)} = "{value}"\n')
            seen.add(found.group(2))
            continue
        written.append(line)
    missing = set(FIELDS) - seen
    if missing:
        print(f"task.toml carries no {', '.join(sorted(missing))} line to fill")
        return 1
    moved = sum(1 for before, after in zip(lines, written) if before != after)
    if len(lines) != len(written) or moved > 2:
        print(f"refusing to write: {moved} lines moved, only the two display fields may")
        return 1
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("".join(written))
    print(f"wrote {target} ({moved} of {len(lines)} lines changed)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
