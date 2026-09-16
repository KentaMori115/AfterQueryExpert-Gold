
# Node 24 runs this repository's TypeScript straight from source, so both
# selections are driven without the installed test runner and without any
# configuration file out of /app: nothing a submission adds under /app can
# stand in for the framework that decides what a case reports. The runner
# lives outside /app, reads a per-run token before a single repository module
# loads, and reports each case on stdout. A python3 publisher that never
# imports repository code turns that stream into the two reports config.json
# names, and publishes every declared id whatever the child did.
set +e
mkdir -p /logs/verifier

VERIFY_DIR=/verify
if ! mkdir -p "$VERIFY_DIR" 2>/dev/null; then
  VERIFY_DIR="$(mktemp -d 2>/dev/null || echo /tmp/bw-verify)"
  mkdir -p "$VERIFY_DIR" 2>/dev/null
fi
log "harness in $VERIFY_DIR"

cat > "$VERIFY_DIR/shim.mjs" <<'__SHIM__'
__SHIM__

cat > "$VERIFY_DIR/hooks.mjs" <<'__HOOKS__'
__HOOKS__

cat > "$VERIFY_DIR/run.mjs" <<'__RUN__'
__RUN__

cat > "$VERIFY_DIR/publish.py" <<'__PUBLISH__'
__PUBLISH__

chmod 0444 "$VERIFY_DIR"/*.mjs "$VERIFY_DIR"/*.py 2>/dev/null
chmod 0555 "$VERIFY_DIR" 2>/dev/null
chown -R root:root "$VERIFY_DIR" 2>/dev/null

# The suites the repository ships come back from the base commit before
# anything runs: an edited assertion must never stand in for a passing build.
BASE_SHA="$(python3 -c 'import json;print(json.load(open("/tests/config.json")).get("base_commit",""))' 2>/dev/null)"
if [ -n "$BASE_SHA" ]; then
  for _pinned in "ecosystem-lab/cli/commands.cli.test.ts" "ecosystem-lab/complete-biomes/crystal-tundra.biome.test.ts" "ecosystem-lab/invalid-models/invalid.biome.test.ts" "ecosystem-lab/properties/conservation.test.ts" "ecosystem-lab/properties/determinism.test.ts" "ecosystem-lab/properties/locale.test.ts" "ecosystem-lab/properties/metamorphic.test.ts" "packages/biome-model/src/compile.test.ts" "packages/biome-model/src/decode.catalog.test.ts" "packages/biome-model/src/identifiers.test.ts" "packages/biome-model/src/species.catalog.test.ts" "packages/biome-reports/src/render.test.ts" "packages/biomeweaver-cli/src/commands.catalog.test.ts" "packages/biomeweaver-cli/src/options.test.ts" "packages/biomeweaver/src/baseline-guard.test.ts" "packages/calendar-engine/src/seasons.test.ts" "packages/capsule-source/src/diagnostics/diagnostic.test.ts" "packages/capsule-source/src/discovery/discover.test.ts" "packages/capsule-source/src/gather/fingerprint.test.ts" "packages/capsule-source/src/gather/gather.test.ts" "packages/capsule-source/src/json/parse-json.test.ts" "packages/capsule-source/src/yaml/parse-yaml.test.ts" "packages/fixed-point/src/arithmetic.test.ts" "packages/fixed-point/src/catalog.test.ts" "packages/fixed-point/src/coverage.test.ts" "packages/fixed-point/src/parse.test.ts" "packages/fixed-point/src/rounding.test.ts" "packages/flow-explanations/src/catalog.test.ts" "packages/flow-explanations/src/flow.test.ts" "packages/population-engine/src/cohorts.test.ts" "packages/population-engine/src/stages.test.ts" "packages/predation-engine/src/consume.test.ts" "packages/resource-engine/src/allocate.test.ts" "packages/resource-engine/src/renew.test.ts" "packages/run-store/src/store.test.ts" "packages/tick-runtime/src/advance.test.ts" "vitest.shared.ts" "vitest.unit.config.ts" "vitest.biomes.config.ts" "vitest.properties.config.ts" "vitest.cli.config.ts" "tsconfig.json" "tsconfig.base.json" "package.json" "ecosystem-lab/helpers/paths.ts"; do
    git -C /app checkout -q "$BASE_SHA" -- "$_pinned" 2>>"$RUN_LOG" || log "could not restore $_pinned"
  done
else
  log "WARNING: no base commit in config.json, shipped suites not restored"
fi

# node_modules is ignored by the repository, not refused: a submission can
# force-add a tree there and the grader will apply it. Whatever arrived
# tracked goes before the runner starts.
_smuggled="$(git -C /app ls-files -z node_modules 2>/dev/null | tr -dc "\0" | wc -c | tr -d " ")"
if [ "${_smuggled:-0}" != "0" ]; then
  log "removing $_smuggled tracked files under node_modules"
  git -C /app ls-files -z node_modules 2>/dev/null | (cd /app && xargs -0 -r rm -f) 2>>"$RUN_LOG"
fi

# Where the per-run tokens are written. Mode 0700 and root owned: the child can
# neither list the directory nor open what is in it, and holds a token only as
# a descriptor handed over before privileges were dropped.
TOKEN_DIR="$VERIFY_DIR/run"
mkdir -p "$TOKEN_DIR" 2>/dev/null
chown root:root "$TOKEN_DIR" 2>/dev/null
chmod 0700 "$TOKEN_DIR" 2>/dev/null

# The graded child runs unprivileged, and the suites it runs write run
# snapshots into the capsule they simulate, so the tree under test is handed to
# the same unprivileged user. Nothing it can reach that way is used for
# grading: the harness, the whitelist and the reports all stay with root.
if [ "$(id -u 2>/dev/null || echo 1)" = "0" ]; then
  chown -R 65534:65534 /app 2>/dev/null || log "could not hand /app to the run user"
fi

# TypeScript runs from source, so the interpreter has to transform it. Take the
# quietest set of flags this node accepts and say which one that was.
NODE_FLAGS=""
for _candidate in \
  "--experimental-transform-types --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON" \
  "--experimental-transform-types" \
  "--experimental-strip-types" \
  ""; do
  if node $_candidate -e "" >/dev/null 2>&1; then
    NODE_FLAGS="$_candidate"
    break
  fi
done
log "node flags: ${NODE_FLAGS:-none}"
AS_NOBODY=""
if [ "$(id -u 2>/dev/null || echo 1)" = "0" ] && command -v setpriv >/dev/null 2>&1; then
  AS_NOBODY="setpriv --reuid=65534 --regid=65534 --clear-groups"
fi

run_selection() {
  _bucket="$1"; _out="$2"; shift 2
  _tokf="$TOKEN_DIR/$_bucket"
  rm -f "$_tokf" 2>/dev/null
  ( umask 077; head -c 24 /dev/urandom 2>/dev/null | od -An -tx1 2>/dev/null | tr -d " \n" > "$_tokf" ) 2>/dev/null
  if [ ! -s "$_tokf" ]; then
    ( umask 077; { date +%s%N; echo "$$ $_bucket"; } 2>/dev/null | cksum | tr -d " \n" > "$_tokf" ) 2>/dev/null
  fi
  chmod 0400 "$_tokf" 2>/dev/null
  # One descriptor for each end of the pipeline, and then the name goes. What
  # is left cannot be opened by path by anyone, so the token survives even a
  # run where privileges could not be dropped; the child shuts its copy before
  # the first repository module loads.
  exec 7<"$_tokf" 8<"$_tokf" 2>/dev/null
  rm -f "$_tokf" 2>/dev/null
  echo "+ $_bucket selection: $*" >> "$RUN_LOG" 2>/dev/null
  HARNESS_APP=/app HARNESS_HOOKS="$VERIFY_DIR/hooks.mjs" HARNESS_SHIM="$VERIFY_DIR/shim.mjs" \
    timeout 900 $AS_NOBODY node $NODE_FLAGS "$VERIFY_DIR/run.mjs" "$@" <&8 8<&- 7<&- 2>>"$RUN_LOG" \
    | python3 "$VERIFY_DIR/publish.py" --bucket "$_bucket" --out "$_out" 3<&7 7<&- 8<&-
  exec 7<&- 8<&- 2>/dev/null
}

if ! command -v node >/dev/null 2>&1; then
  log "ERROR: no node on PATH, publishing every case as failed"
fi

log "running the settlement cases"
run_selection new /logs/verifier/new_junit.xml "packages/predation-engine/src/rationing.test.ts" "packages/predation-engine/src/saturation.test.ts"

log "running the rest of the suite"
run_selection base /logs/verifier/base_junit.xml "ecosystem-lab/cli/commands.cli.test.ts" "ecosystem-lab/complete-biomes/crystal-tundra.biome.test.ts" "ecosystem-lab/invalid-models/invalid.biome.test.ts" "ecosystem-lab/properties/conservation.test.ts" "ecosystem-lab/properties/determinism.test.ts" "ecosystem-lab/properties/locale.test.ts" "ecosystem-lab/properties/metamorphic.test.ts" "packages/biome-model/src/compile.test.ts" "packages/biome-model/src/decode.catalog.test.ts" "packages/biome-model/src/identifiers.test.ts" "packages/biome-model/src/species.catalog.test.ts" "packages/biome-reports/src/render.test.ts" "packages/biomeweaver-cli/src/commands.catalog.test.ts" "packages/biomeweaver-cli/src/options.test.ts" "packages/biomeweaver/src/baseline-guard.test.ts" "packages/calendar-engine/src/seasons.test.ts" "packages/capsule-source/src/diagnostics/diagnostic.test.ts" "packages/capsule-source/src/discovery/discover.test.ts" "packages/capsule-source/src/gather/fingerprint.test.ts" "packages/capsule-source/src/gather/gather.test.ts" "packages/capsule-source/src/json/parse-json.test.ts" "packages/capsule-source/src/yaml/parse-yaml.test.ts" "packages/fixed-point/src/arithmetic.test.ts" "packages/fixed-point/src/catalog.test.ts" "packages/fixed-point/src/coverage.test.ts" "packages/fixed-point/src/parse.test.ts" "packages/fixed-point/src/rounding.test.ts" "packages/flow-explanations/src/catalog.test.ts" "packages/flow-explanations/src/flow.test.ts" "packages/population-engine/src/cohorts.test.ts" "packages/population-engine/src/stages.test.ts" "packages/predation-engine/src/consume.test.ts" "packages/resource-engine/src/allocate.test.ts" "packages/resource-engine/src/renew.test.ts" "packages/run-store/src/store.test.ts" "packages/tick-runtime/src/advance.test.ts"
set -e
