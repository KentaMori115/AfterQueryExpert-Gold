#!/usr/bin/env python3
"""Every opcode the engine knows has to appear in a graded stack-effect case.

The instruction says each opcode takes and leaves what the opcode reference
documents. That is one sentence covering thirty-nine behaviours, so the only
honest way to hold the suites to it is to enumerate the opcodes from the
source and look for each one.
"""
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
BUILD = HERE / "build"

ops = re.findall(r"^pub const (OP_\w+): u8", (BUILD / "src/bytecode.rs").read_text(), re.M)
suites = "".join((BUILD / f"tests/{n}.rs").read_text() for n in ("stack_shape", "image_faults"))
shape_only = (BUILD / "tests/stack_shape.rs").read_text()

missing = [op for op in ops if not re.search(rf"\b{op}\b", shape_only)]
print(f"{len(ops)} opcodes, {len(ops) - len(missing)} named by a stack-shape case")
for op in missing:
    print(f"  MISSING from tests/stack_shape.rs: {op}")
unseen = [op for op in ops if not re.search(rf"\b{op}\b", suites)]
for op in unseen:
    print(f"  MISSING from both suites: {op}")
sys.exit(1 if missing else 0)
