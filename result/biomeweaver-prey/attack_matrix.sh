#!/bin/bash
# Rows that prove the verifier cannot be talked out of its verdict. Each row is
# a patch graded exactly the way a submission is: the graded files come back
# from test.patch, the runner configuration comes from test.sh, and a run that
# ends badly publishes failures rather than silence.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
base="$here/base-tree"
work="$here/repo"
out="$here/attacks"
mkdir -p "$out"

build_patch() {   # build_patch <name> <shell body run inside a clean base tree>
  local name="$1"; shift
  cd "$base"
  git reset -q --hard HEAD
  git clean -fdq -e node_modules
  bash -c "$1"
  git add -A
  git diff --cached > "$out/$name.patch"
  git reset -q --hard HEAD
  git clean -fdq -e node_modules
  cd "$here"
}

# 1. the graded cases replaced with cases that assert nothing
build_patch fake-tests '
mkdir -p packages/predation-engine/src
cat > packages/predation-engine/src/rationing.test.ts <<TS
import { describe, expect, it } from "vitest";
describe("contested prey", () => {
  it("splits a prey cohort across two predator cohorts in proportion to their asks", () => {
    expect(1).toBe(1);
  });
});
TS
cat > packages/predation-engine/src/saturation.test.ts <<TS
import { describe, expect, it } from "vitest";
describe("saturated asks", () => {
  it("asks for less than the flat rate where prey are thin", () => {
    expect(1).toBe(1);
  });
});
TS
'

# 2. a runner configuration that would skip the graded files and load a setup
build_patch fake-config '
cat > vitest.config.ts <<TS
export default {
  test: {
    include: [],
    exclude: ["**/*.test.ts"],
    setupFiles: ["./verify-setup.ts"],
  },
};
TS
cat > verify-setup.ts <<TS
/* a setup file that would neuter the assertions if anything loaded it */
TS
cat > vitest.workspace.ts <<TS
export default ["."];
TS
'

# 3. the package under test walks out of the process as soon as it is imported
build_patch exit-on-import '
cat >> packages/predation-engine/src/index.ts <<TS

process.exit(0);
TS
'

# 6. the package under test tries to write the verdict stream itself: it prints
#    lines of its own, and it wraps the writer so that any token the runner
#    prints can be reused for cases that never ran.
build_patch forge-stream '
cat >> packages/predation-engine/src/index.ts <<TS

const graded = [
  "packages/predation-engine/src/rationing.test.ts\tcontested prey > splits a prey cohort across two predator cohorts in proportion to their asks",
  "packages/predation-engine/src/saturation.test.ts\tsaturated asks > asks for less than the flat rate where prey are thin",
];
const write = process.stdout.write.bind(process.stdout);
process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
  const text = String(chunk);
  const found = /^V ([0-9a-f]+) /m.exec(text);
  if (found) {
    for (const row of graded) {
      write(\`V \${found[1]} pass \${row}\n\`);
    }
    process.stdout.write = write as typeof process.stdout.write;
  }
  return (write as (...args: unknown[]) => boolean)(chunk, ...rest);
}) as typeof process.stdout.write;
write("V deadbeef pass " + graded[0] + "\n");
TS
'

# 4. the whole predation package deleted
build_patch drop-package '
rm -rf packages/predation-engine/src
mkdir -p packages/predation-engine/src
echo "export {};" > packages/predation-engine/src/index.ts
'

build_patch bent-suite "bash $here/attacks/bent-suite.sh"

for row in fake-tests fake-config exit-on-import forge-stream drop-package bent-suite; do
  echo "===== $row"
  "$here/verify_task.sh" attack "$out/$row.patch" 2>&1 | grep -E "P2P |reward.json=|did not apply" | tail -2
done

# 5. a correct build of a different shape: one file, other names, no helper
#    modules of mine at all. Every graded case has to pass on this one, or the
#    cases are grading my structure rather than the behaviour asked for.
build_patch other-shape '
cp '"$here"'/altbuild/consume.ts packages/predation-engine/src/consume.ts
python3 - <<PY
from pathlib import Path
p = Path("packages/biome-model/src/records.ts"); s = p.read_text()
s = s.replace("""  readonly perPredatorPerTick: Fixed;
};""", """  readonly perPredatorPerTick: Fixed;
  readonly saturation?: Fixed;
};""", 1)
s = s.replace("""  readonly predation: readonly PredationRule[];""", """  readonly predation: readonly PredationRule[];
  readonly maxIntakePerTick?: Fixed;""", 1)
p.write_text(s)

p = Path("packages/biome-model/src/decode.ts"); s = p.read_text()
s = s.replace("""    return [{ prey, preyStage, perPredatorPerTick: per }];""",
"""    const sat = row === undefined || row["saturation"] === undefined
      ? undefined
      : parseQuantity(row["saturation"], scale, "predation.saturation", path, diagnostics);
    if (sat !== undefined && sat < 0n) {
      diagnostics.push(diagnostic("BW-ID-002", "error", "negative saturation", sourceLocation(path)));
      return [];
    }
    return [{ prey, preyStage, perPredatorPerTick: per, ...(sat === undefined ? {} : { saturation: sat }) }];""", 1)
s = s.replace("""  return {
    kind: "species",""",
"""  const capRaw = record["maxIntakePerTick"];
  const cap = capRaw === undefined
    ? undefined
    : parseQuantity(capRaw, scale, "maxIntakePerTick", path, diagnostics);
  if (cap !== undefined && cap < 0n) {
    diagnostics.push(diagnostic("BW-ID-002", "error", "negative cap", sourceLocation(path)));
    return undefined;
  }
  return {
    kind: "species",""", 1)
s = s.replace("""    transitions,
    predation,
    location: sourceLocation(path),""",
"""    transitions,
    predation,
    ...(cap === undefined ? {} : { maxIntakePerTick: cap }),
    location: sourceLocation(path),""", 1)
p.write_text(s)

p = Path("packages/biome-model/src/compile.ts"); s = p.read_text()
s = s.replace("""    for (const rule of spec.predation) {""",
"""    if (spec.maxIntakePerTick !== undefined && spec.predation.length === 0) {
      diagnostics.push(diagnostic("BW-PRED-001", "warning", "cap without prey", spec.location));
    }
    for (const rule of spec.predation) {""", 1)
p.write_text(s)
PY
'

echo "===== other-shape (expects reward 1)"
"$here/verify_task.sh" attack "$out/other-shape.patch" 2>&1 | grep -E "P2P |reward.json=" | tail -2
