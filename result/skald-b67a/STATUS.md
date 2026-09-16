# skald — build log (session b67a9e2a)

## The codebase

Rust port of a C scripting engine: tagged `Value`, refcounted object heap,
tri-color GC, binary chunk loader, lexer, stack VM, JSON codec, plus `ds/`,
`util/`, `stdlib/`, `metrics/`, `diag/`. Zero dependencies, `cargo test`
green offline in 3.2 s, 201 cases over 10 integration targets.

## Claimed (session b67a9e2a, 2026-09-05)

- task name: `chunk-audit` (proposed to the user, awaiting the draft)
- category: feature_request
- changed-file set: `src/verify/` (new), `src/lib.rs`, `src/bin/skald.rs`,
  `README.md`. Nothing under `ds/`, `util/`, `stdlib/`, `gc.rs`, `heap.rs`,
  `json.rs`, `lexer.rs`, `vm.rs`, `bytecode.rs` is touched.
- held-out targets: `tests/verify_*.rs` (new files only)

Other sessions on skald: take a different subsystem. `verify/` and the
`validate` CLI arm are reserved here.

## Where the gap is

`chunk_load` checks lengths and ceilings only; nothing reads the code stream.
The FAQ says as much, and `skald validate` reports the header and stops. So a
chunk that loads can still hold an unknown opcode, a jump landing mid
instruction, a constant index past the pool, or a call whose argument count
disagrees with the callee. The VM finds these one at a time at run time.

## State

- [x] snapshot unpacked, base suite green (201 cases, 3 s)
- [x] reference solution: +692 / -14 over 6 files
- [x] held-out tests: +687 over two files, 60 f2p ids
- [x] instruction: 294 words, detector clean
- [x] mutation battery 14 of 14, fuzz cross-check against the interpreter
- [x] Step 0: environment v1 is `rust:1.92-slim-bookworm` with build-essential
      and cargo-nextest, so the repo is gradeable
- [x] draft `llbYfP7u7lzO4VDezIqi` on repo `2G9D18szl7aNlQIbAKTv`
- [x] verifier ported from tanager, battery green: oracle 69/201, seven attack
      rows refused, a differently shaped implementation still 69/201
- [x] **PASSED all 8 stages 2026-09-06 on round 8**, status Needs Review.
      Do not push again.

Five rounds so far: quality review twice on `behavior_in_tests` (opcode
coverage, then the unenforced one-flaw-per-instruction precedence), and
Calibration II twice (out_of_band_hard from a width bug in a test helper, then
too_easy at 8 of 8). Round 5 carries the interprocedural entry depths and the
precedence rule: 79 f2p, 201 p2p, 18 of 18 mutants caught.

Detail in `tasks/chunk-audit/NOTES.md`.
