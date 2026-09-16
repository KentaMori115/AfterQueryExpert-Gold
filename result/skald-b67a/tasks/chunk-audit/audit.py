#!/usr/bin/env python3
"""Two directions in one pass.

Forward: every name and string literal the graded suites touch is either in the
base checkout or named by instruction.md. A test that reaches for something
neither states is pinning a contract the request never made.

Back: every graded id is listed, so the mapping from ids to the sentences that
license them can be read rather than remembered.
"""
import pathlib
import re
import subprocess

HERE = pathlib.Path(__file__).resolve().parent
BUILD = HERE / "build"
SUITES = ["tests/image_faults.rs", "tests/stack_shape.rs"]

base_files = subprocess.run(["git", "ls-tree", "-r", "--name-only", "main"],
                            cwd=BUILD, capture_output=True, text=True, check=True).stdout.split()
base_text = ""
for name in base_files:
    if name.endswith((".rs", ".md", ".toml")):
        base_text += subprocess.run(["git", "show", f"main:{name}"], cwd=BUILD,
                                    capture_output=True, text=True, check=True).stdout

instruction = (HERE / "instruction.md").read_text()
rust_words = set("""
use fn let mut if else for while loop match return true false pub mod crate self
super as in ref move impl struct enum trait type const static unsafe where dyn
assert assert_eq assert_ne vec format println panic expect unwrap Some None Ok Err
Vec String u8 u16 u32 u64 i8 i16 i32 i64 usize isize bool str to_le_bytes iter map
collect len is_empty push extend extend_from_slice clone copied flat_map to_vec
test cfg derive Debug Clone Copy PartialEq Eq into from parts kind offset func
""".split())

unknown = {}
for suite in SUITES:
    text = (BUILD / suite).read_text()
    defined = set(re.findall(r"\nfn ([a-z0-9_]+)", text)) | set(re.findall(r"let (?:mut )?([a-z0-9_]+)", text))
    defined |= set(re.findall(r"#\[test\]\s*\nfn ([a-z0-9_]+)", text))
    code = "\n".join(l for l in text.splitlines() if not l.lstrip().startswith(("//", "//!")))
    reached = set(re.findall(r"\b([A-Z][A-Za-z0-9_]+)\b", code))            # types and constants
    reached |= set(re.findall(r"\b([a-z_][a-z0-9_]*)\s*\(", code))          # calls
    reached |= set(re.findall(r"\.([a-z_][a-z0-9_]*)\b", code))             # fields and methods
    for ident in sorted(reached):
        if ident in defined or ident in rust_words:
            continue
        if re.search(rf"\b{re.escape(ident)}\b", base_text):
            continue
        if re.search(rf"\b{re.escape(ident)}\b", instruction):
            continue
        unknown.setdefault(ident, []).append(suite)

literals = {}
for suite in SUITES:
    text = (BUILD / suite).read_text()
    for lit in sorted(set(re.findall(r'"([^"\n]{2,})"', text))):
        if lit.startswith("{") or "loader takes this image" in lit:
            continue
        if lit in base_text or lit in instruction:
            continue
        literals.setdefault(lit, []).append(suite)

print("names neither the base checkout nor the request knows:")
for name, where in unknown.items():
    print(f"  {name}  ({', '.join(where)})")
print("  none" if not unknown else "")

print("string literals neither the base checkout nor the request knows:")
for lit, where in literals.items():
    print(f"  {lit!r}  ({', '.join(where)})")
print("  none" if not literals else "")

ids = []
for suite in SUITES:
    target = pathlib.Path(suite).stem
    for name in re.findall(r"#\[test\]\s*\nfn ([a-z0-9_]+)\(", (BUILD / suite).read_text()):
        ids.append(f"{target}.{name}")
print(f"\n{len(ids)} graded ids")
