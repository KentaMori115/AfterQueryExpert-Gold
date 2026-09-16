#!/usr/bin/env python3
"""Standby: say outright how long the balance rope on a hangAt is.

Held back rather than applied. aiCheck passed on the pushed wording, and a
full re-voice has failed it before, so this is three single-clause edits and
nothing else. Apply only if a stage says the balance rope's length at a point
in the wind was never stated: every trial failing
"carries a balance rope as long as the conveyance is high" is that signal.

    295 words -> 298 words, still inside 100..300.
"""
import pathlib
import sys

EDITS = [
    ("Then `hangAt(winder, up)`, the conveyance `up` metres above the lowest inset,",
     "Then `hangAt(winder, up)`, the conveyance `up` metres above the lowest inset trailing that much balance rope,"),
    ("a load dropped on a spring doing twice what one lowered onto it does",
     "a load dropped on a spring doing twice what one lowered on does"),
    ("What is carried, all of the balance rope, a third of the winding rope.",
     "What is carried, all the balance rope, a third of the winding rope."),
]


def main():
    path = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "instruction.md")
    text = path.read_text()
    for before, after in EDITS:
        if before not in text:
            print(f"pattern already gone: {before[:40]}...", file=sys.stderr)
            return 1
        text = text.replace(before, after, 1)
    path.write_text(text)
    print(f"{len(text.split())} words")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
