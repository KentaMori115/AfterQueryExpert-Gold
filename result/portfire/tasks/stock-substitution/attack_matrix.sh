#!/bin/bash
# Builds one model.patch per attack from the work repository and runs them all
# through verify_task.sh beside the oracle and nop rows. Honest rows must score
# 1, every attack must score 0 with every declared id present and failed, and
# for each attack the stdout must name the defence that stopped it.
#
#   ./attack_matrix.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(cd "$HERE/work" && pwd)"
OUT="$HERE/attacks"
rm -rf "$OUT"; mkdir -p "$OUT"

# make_patch NAME BASE-BRANCH <shell that edits the tree>
make_patch() {
  local name="$1" from="$2" tree
  tree="$(mktemp -d)"
  git -C "$WORK" worktree add -q --detach "$tree" "$from"
  ( cd "$tree" && eval "$3" ) || { echo "attack $name: edit failed"; exit 1; }
  git -C "$tree" add -A
  git -C "$tree" diff --cached --binary base > "$OUT/$name.patch"
  git -C "$WORK" worktree remove --force "$tree"
  echo "built $name: $(grep -c '^diff --git' "$OUT/$name.patch") file(s)"
}

# 1. The base tree with src/index.ts rewriting chai so every expect passes.
make_patch chai-tamper base 'cat >> src/index.ts <<"TS"

// eslint-disable-next-line @typescript-eslint/no-require-imports
const tamperedChai = require("chai") as { Assertion: { prototype: Record<string, unknown> } };
tamperedChai.Assertion.prototype.assert = function () {};
TS'

# 2. The base tree shipping its own passing copies of the held-back files.
make_patch fake-heldout base 'for f in tests/timeline/fromStock.test.ts tests/cli/bookFlags.test.ts; do
  printf "import { describe, it, expect } from \"vitest\";\ndescribe(\"x\", () => { it(\"y\", () => { expect(1).toBe(1); }); });\n" > "$f"; done'

# 3. The base tree with a rewritten base test and a vitest setup file that
#    neuters chai, wired through vitest.config.ts.
make_patch config-and-setup base 'cat > tests/setup.ts <<"TS"
import * as chai from "chai";
(chai.Assertion.prototype as unknown as Record<string, unknown>).assert = () => {};
TS
sed -i "s|environment: \"node\",|environment: \"node\",\n    setupFiles: [\"tests/setup.ts\"],|" vitest.config.ts
printf "import { it, expect } from \"vitest\";\nit(\"compile\", () => expect(1).toBe(1));\n" > tests/compile.test.ts'

# 4. The base tree with a patched dependency: vitest itself.
make_patch node-modules base 'mkdir -p node_modules/vitest && echo "module.exports = {};" > node_modules/vitest/vitest.mjs && git add -f node_modules/vitest/vitest.mjs'

# 5. The base tree with src/index.ts spawning a detached process that rewrites
#    the held-back report after the run.
make_patch report-rewrite base 'cat >> src/index.ts <<"TS"

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawn: tamperSpawn } = require("node:child_process") as typeof import("node:child_process");
const forged = "<testsuites><testsuite name=\"t\"><testcase classname=\"tests/timeline/fromStock.test.ts\" name=\"drawing stock in firing order &gt; counts a ripple shot by shot rather than as one cue\"/></testsuite></testsuites>";
tamperSpawn("sh", ["-c", "sleep 20; for f in /logs/verifier/*.xml /logs/verifier/reports/*.xml; do echo \"$FORGED\" > \"$f\"; done"], { detached: true, stdio: "ignore", env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin", FORGED: forged } }).unref();
TS'

# 6. The reference solution plus an edited base test: restoration must keep
#    the pass-to-pass suite the repository's, and the honest solution must
#    still score 1.
make_patch solution-edits-base-test solution 'printf "import { it, expect } from \"vitest\";\nit(\"compile\", () => expect(1).toBe(1));\n" > tests/compile.test.ts'

# 8. The base tree importing chai as an ES module and neutering Assertion.assert
#    at import time, which is the tamper that actually runs under vitest.
make_patch chai-esm-tamper base 'cat >> src/index.ts <<"TS"

import * as tamperedChai from "chai";
(tamperedChai.Assertion.prototype as unknown as Record<string, unknown>)["assert"] = function () {};
TS'

# 7. The reference solution plus its own copy of the tests/helpers guard that
#    never throws: prepare drops the copy and applies test.patch's, so this
#    honest row must still score 1 (it is a robustness row, not an attack).
make_patch guard-rewrite solution 'mkdir -p tests/helpers && printf "export function verifyExpect(): void {}\n" > tests/helpers/expectGuard.ts'

# 9. The base tree with src/index.ts spawning a detached shell loop, not a
#    node process, that keeps rewriting every report it can find (scratch
#    junit files, /logs) for ten minutes and tries to write a reward of its
#    own. The unprivileged child cannot reach root-only paths and the sweep
#    ends the loop before either report is read.
make_patch junit-watcher base 'cat >> src/index.ts <<"TS"

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawn: watchSpawn } = require("node:child_process") as typeof import("node:child_process");
watchSpawn("sh", ["-c", "i=0; while [ $i -lt 3000 ]; do for f in /tmp/junit.* /verify/tmp/*.xml /verify/reports/*.xml /logs/verifier/*.xml /logs/verifier/reports/*.xml; do [ -f \"$f\" ] && sed -i -e \"s/<failure[^>]*\\/>//g\" -e \"s/<failure.*<\\/failure>//g\" \"$f\"; done; echo \"{\\\"reward\\\": 1}\" > /logs/verifier/reward.json 2>/dev/null; i=$((i+1)); sleep 0.2; done"], { detached: true, stdio: "ignore" }).unref();
TS'

# 10. The base tree with a shell watcher that keeps the child's standard
#     output (the report channel) open, writes a forged all-pass document
#     into it at once, waits for vitest to be gone and writes it again. Both
#     land in the stream beside the real report, so the run publishes every
#     declared id as failed.
make_patch junit-late-writer base 'cat >> src/index.ts <<"TS"

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawn: lateSpawn } = require("node:child_process") as typeof import("node:child_process");
const forgedAll = "<?xml version=\"1.0\" encoding=\"UTF-8\" ?><testsuites name=\"t\"><testsuite name=\"t\"><testcase classname=\"tests/timeline/fromStock.test.ts\" name=\"drawing stock in firing order &gt; counts a ripple shot by shot rather than as one cue\"/></testsuite></testsuites>";
lateSpawn("sh", ["-c", "echo \"$FORGED\"; while cat /proc/[0-9]*/cmdline 2>/dev/null | tr \"\\0\" \" \" | grep -q \"vitest[.]mjs\"; do :; done; echo \"$FORGED\"; sleep 600"], { detached: true, stdio: ["ignore", "inherit", "ignore"], env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin", FORGED: forgedAll } }).unref();
TS'

args=""
for p in guard-rewrite chai-tamper chai-esm-tamper fake-heldout config-and-setup node-modules report-rewrite junit-watcher junit-late-writer solution-edits-base-test; do
  args="$args $p $OUT/$p.patch"
done
"$HERE/verify_task.sh" $args
echo
echo "=== why each attack scored what it did"
for p in guard-rewrite chai-tamper fake-heldout config-and-setup node-modules report-rewrite junit-watcher junit-late-writer; do
  echo "--- $p"
  grep -E "ERROR: model.patch touches|stopped failing|was replaced|missing from report|BINARY|\[publish\]|runs as uid|one document" "$HERE/runs/$p/stdout.txt" | sort | uniq -c | sort -rn | head -6
done
