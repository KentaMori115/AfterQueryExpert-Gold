#!/bin/bash
# Verifier entrypoint (canonical frame). Patching and grading live in
# tests/grader.py; this script owns the task-specific part: run the suites,
# write machine-readable reports under /logs/verifier/, and apply any report
# fixups before grading. Edit ONLY between the RUN TESTS markers.
set -uo pipefail
trap 'if [ ! -f /logs/verifier/reward.json ] && [ ! -f /logs/verifier/reward.txt ]; then mkdir -p /logs/verifier; echo -1 > /logs/verifier/reward.txt; fi' EXIT
log() { echo "[verifier] $*"; }
cd /app || { mkdir -p /logs/verifier; exit 6; }

python3 /tests/grader.py prepare || exit $?
[ -f /logs/verifier/reward.json ] && exit 0   # model.patch didn't apply -> graded 0

# Canonical raw-output log: send every suite's combined stdout+stderr here
# (use run_log, or pipe through tee -a "$RUN_LOG" when feeding a reporter) so
# the reason a test failed is never lost. Never silence a test run.
export RUN_LOG=/logs/verifier/run.log
: > "$RUN_LOG" 2>/dev/null || true
run_log() { echo "+ $*" >> "$RUN_LOG" 2>/dev/null; "$@" 2>&1 | tee -a "$RUN_LOG"; return "${PIPESTATUS[0]}"; }

# >>> RUN TESTS (task-specific) <<<
# Two vitest selections: the repository's own suite (pass-to-pass) and the
# held-back site-sheet tests (fail-to-pass). The suites import the submitted
# src/ before a single case runs, so how the tests are found, loaded and
# asserted comes from the repository, never from the change: the whole test
# tree and the run configuration are restored from the base commit and
# digest-checked against digests this shell holds in memory. Reports are not
# written by the process that runs submitted code: a root publisher that
# never loads anything from /app mints a per-run token, hands it to the
# vitest child on stdin, hears one verdict line per case back on a private
# descriptor from a reporter of its own, and writes the XML only after the
# child has exited. The child runs as an unprivileged user (nobody, via
# setpriv) whenever this script is root, so nothing imported from /app can
# write to /app, /tests, /verify or /logs, or signal the publisher. Between
# the two suites every process the first one started is ended, the held-back
# files are put back from root-only copies and digest-checked again, and a
# mismatch that survives the restore refuses the suite: every declared id is
# then published as failed, with the reason in this log.
BASE=cbfb245b02c044e160ca8346fc17ce78eb374ddc
BASE_REPORT=/logs/verifier/base.xml
NEW_REPORT=/logs/verifier/new.xml
MODEL_PATCH=/logs/artifacts/model.patch
unset NODE_OPTIONS NODE_PATH VITEST VITEST_MODE

# Only root reads the verifier's own directory from here on. Knowing which
# ids are graded is the difference between forging a report and reproducing
# a whole run, and nothing the suites do needs that list.
chmod -R go-rwx /tests 2>/dev/null || true

VDIR=/verify
mkdir -p "$VDIR" 2>/dev/null || VDIR=$(mktemp -d)
RPTDIR="$VDIR/reports"
KEEP="$VDIR/keep"
mkdir -p "$RPTDIR" "$KEEP" 2>/dev/null || true

# The only directory the child may write: vite's config bundle and cache,
# temporary files, a home. Neither the publisher nor grading reads it.
SUITE_TMP="$VDIR/tmp"
mkdir -p "$SUITE_TMP" 2>/dev/null || SUITE_TMP=$(mktemp -d)
chmod 1777 "$SUITE_TMP" 2>/dev/null || true

# Drop privileges for the child. When setpriv or the account is missing the
# block runs the child as the current user rather than refusing to run at
# all, and says so in the log.
RUNAS=""
if [ "$(id -u)" = "0" ] && command -v setpriv >/dev/null 2>&1; then
  RUN_UID=$(id -u nobody 2>/dev/null || echo 65534)
  RUN_GID=$(id -g nogroup 2>/dev/null || id -g nobody 2>/dev/null || echo 65534)
  if setpriv --reuid="$RUN_UID" --regid="$RUN_GID" --clear-groups true >/dev/null 2>&1; then
    RUNAS="setpriv --reuid=$RUN_UID --regid=$RUN_GID --clear-groups"
    log "vitest child runs as uid $RUN_UID gid $RUN_GID"
  fi
fi
if [ -z "$RUNAS" ]; then
  log "no setpriv; the publisher drops the vitest child to nobody itself"
fi
export RUNAS SUITE_TMP

P2P_FILES="tests/catalog/calibre.test.ts tests/catalog/effect.test.ts tests/catalog/envelope.test.ts tests/catalog/hazard.test.ts tests/catalog/inventory.test.ts tests/catalog/lift.test.ts tests/catalog/magazine.test.ts tests/catalog/palette.test.ts tests/catalog/parse.test.ts tests/catalog/registry.test.ts tests/catalog/substitute.test.ts tests/catalog/timing.test.ts tests/catalog/validate.test.ts tests/cli/args.test.ts tests/cli/command.test.ts tests/cli/commands.test.ts tests/cli/completion.test.ts tests/cli/diffHazard.test.ts tests/cli/distance.test.ts tests/cli/label.test.ts tests/cli/lint.test.ts tests/cli/permitContinuity.test.ts tests/cli/planLayout.test.ts tests/cli/preview.test.ts tests/cli/sheetInventory.test.ts tests/compile.test.ts tests/core/codes.test.ts tests/core/collect.test.ts tests/core/csv.test.ts tests/core/diagnostic.test.ts tests/core/graph.test.ts tests/core/ids.test.ts tests/core/interval.test.ts tests/core/numeric.test.ts tests/core/result.test.ts tests/core/rng.test.ts tests/core/span.test.ts tests/core/text.test.ts tests/core/timecode.test.ts tests/core/units.test.ts tests/coverage.test.ts tests/endToEnd.test.ts tests/examples.test.ts tests/export/explain.test.ts tests/export/firingTable.test.ts tests/export/json.test.ts tests/export/pack.test.ts tests/export/permit.test.ts tests/export/sheets.test.ts tests/export/siteplan.test.ts tests/large.test.ts tests/rig/allocate.test.ts tests/rig/circuit.test.ts tests/rig/continuity.test.ts tests/rig/layout.test.ts tests/rig/module.test.ts tests/rig/parse.test.ts tests/rig/pin.test.ts tests/rig/redundancy.test.ts tests/rig/rig.test.ts tests/rig/wiring.test.ts tests/robust.test.ts tests/safety/crowd.test.ts tests/safety/distance.test.ts tests/safety/noise.test.ts tests/safety/rules.test.ts tests/safety/site.test.ts tests/safety/wind.test.ts tests/script/annotate.test.ts tests/script/ast.test.ts tests/script/expand.test.ts tests/script/format.test.ts tests/script/include.test.ts tests/script/lint.test.ts tests/script/parser.test.ts tests/script/renumber.test.ts tests/script/resolve.test.ts tests/script/token.test.ts tests/sim/preview.test.ts tests/sim/trajectory.test.ts tests/surface.test.ts tests/timeline/balance.test.ts tests/timeline/chain.test.ts tests/timeline/density.test.ts tests/timeline/diff.test.ts tests/timeline/load.test.ts tests/timeline/misfire.test.ts tests/timeline/quantise.test.ts tests/timeline/rehearsal.test.ts tests/timeline/schedule.test.ts tests/timeline/sync.test.ts tests/version.test.ts"
CONFIG_FILES="vitest.config.ts package.json package-lock.json tsconfig.json"
NEW_FILES="tests/safety/siteGuard.ts tests/safety/siteSheet.test.ts tests/cli/siteFlags.test.ts"
NEW_RUN="tests/safety/siteSheet.test.ts tests/cli/siteFlags.test.ts"

# The reporter the child loads: it belongs to the verifier, runs in vitest's
# own process, and only ever learns the token from stdin, which it reads
# before any worker exists. A line without the token is ignored by the
# publisher, so a worker running submitted code has nothing to forge with.
cat > "$VDIR/reporter.mjs" <<'MJS'
import fs from "node:fs";

function readToken() {
  try {
    const raw = fs.readFileSync(0, "utf8");
    return raw.split("\n")[0].trim();
  } catch {
    return "";
  }
}

function fullName(task) {
  const names = [task.name];
  let current = task;
  while (current && current.suite) {
    current = current.suite;
    if (current && current.name) {
      names.unshift(current.name);
    }
  }
  return names.join(" > ");
}

function walk(task, file, out) {
  if (task.type === "test") {
    const mode = task.mode;
    const state = task.result ? task.result.state : undefined;
    let verdict = "failed";
    if (mode === "skip" || mode === "todo" || state === "skip") {
      verdict = "skipped";
    } else if (state === "pass") {
      verdict = "passed";
    }
    out.push([file.name, fullName(task), verdict]);
    return;
  }
  for (const child of task.tasks || []) {
    walk(child, file, out);
  }
}

export default class VerdictReporter {
  constructor() {
    this.token = readToken();
    this.fd = Number(process.env.VERDICT_FD || "3");
    this.pid = process.pid;
  }

  onInit() {}

  onFinished(files = []) {
    if (process.pid !== this.pid) {
      return;
    }
    const rows = [];
    for (const file of files) {
      walk(file, file, rows);
    }
    let count = 0;
    for (const [cls, name, verdict] of rows) {
      fs.writeSync(this.fd, `V ${this.token} ${verdict} ${cls}${name}\n`);
      count += 1;
    }
    fs.writeSync(this.fd, `END ${this.token} ${count}\n`);
  }
}
MJS

# The publisher: never loads /app code, owns the token and the XML.
cat > "$VDIR/publish.py" <<'PYPUB'
import json
import os
import subprocess
import sys
import xml.sax.saxutils


def declared_ids(xml_path):
    """The ids /tests/config.json declares for this report, so a refused or
    incomplete run still publishes every one of them as failed."""
    try:
        with open("/tests/config.json") as fh:
            config = json.load(fh)
    except Exception:
        return []
    key = "p2p_node_ids" if os.path.basename(xml_path) == "base.xml" else "f2p_node_ids"
    return [nid for nid in config.get(key, []) if isinstance(nid, str)]


def main():
    vdir, xml_path = sys.argv[1], sys.argv[2]
    files = sys.argv[3:]
    token = os.urandom(16).hex()
    r_fd, w_fd = os.pipe()
    runas = os.environ.get("RUNAS", "").split()
    scratch = os.environ.get("SUITE_TMP", "/tmp")
    drop = None
    if not runas and os.geteuid() == 0:
        try:
            import pwd
            _pw = pwd.getpwnam("nobody")
            _uid, _gid = _pw.pw_uid, _pw.pw_gid
        except Exception:
            _uid, _gid = 65534, 65534

        def drop(uid=_uid, gid=_gid):
            os.setgroups([])
            os.setgid(gid)
            os.setuid(uid)
            if os.getuid() != uid or os.geteuid() != uid:
                os._exit(97)

        print("[publish] no setpriv; publisher drops the child to uid %d gid %d itself"
              % (_uid, _gid), flush=True)
    # Descriptor 3 in the child is the verdict pipe. Everything else about the
    # environment is pinned here: no NODE_OPTIONS, a scratch home, the vite
    # config bundle and cache under scratch.
    # The write end travels to the child by number: pass_fds keeps it open
    # across the exec, the reporter reads its number from the environment,
    # and the child's own output goes straight to the run log rather than
    # through a pipe something it started could hold open.
    command = runas + [
        "node", "/app/node_modules/vitest/vitest.mjs", "run",
        "--root", "/app",
        "--config", os.path.join(scratch, "config", "vitest.config.mjs"),
        "--reporter", os.path.join(vdir, "reporter.mjs"),
        "--no-coverage",
    ] + files
    try:
        child = subprocess.Popen(
            command,
            cwd="/app",
            stdin=subprocess.PIPE,
            stdout=sys.stdout.fileno(),
            stderr=subprocess.STDOUT,
            pass_fds=(w_fd,),
            preexec_fn=drop,
            env={"PATH": "/usr/local/bin:/usr/bin:/bin", "TMPDIR": scratch,
                 "HOME": scratch, "LC_ALL": "C.UTF-8", "VERDICT_FD": str(w_fd),
                 "CI": "1"},
        )
    except Exception as exc:
        print("[publish] refused: could not start the child unprivileged (%s); "
              "every declared id is published as failed" % exc, flush=True)
        child = None
    os.close(w_fd)
    if child is not None:
        child.stdin.write((token + "\n").encode())
        child.stdin.flush()
        child.stdin.close()

    rank = {"passed": 0, "skipped": 1, "failed": 2}
    results = {}
    order = []
    heard = 0
    ended = False
    valid = True
    declared = -1
    with os.fdopen(r_fd, "r", errors="replace") as stream:
        for raw in stream:
            line = raw.rstrip("\n")
            parts = line.split(" ", 3)
            if len(parts) == 3 and parts[0] == "END" and parts[1] == token:
                # Nothing after END is read: the count it carries is checked
                # against what was heard, and a writer that lingers cannot
                # hold this loop open.
                ended = True
                declared = int(parts[2]) if parts[2].isdigit() else -1
                break
            if len(parts) == 4 and parts[0] == "V" and parts[1] == token:
                outcome, payload = parts[2], parts[3]
                if outcome not in rank or "\x1f" not in payload:
                    valid = False
                    break
                cls, _, name = payload.partition("\x1f")
                nid = (cls, name)
                heard += 1
                if nid not in results:
                    order.append(nid)
                    results[nid] = outcome
                elif rank[outcome] > rank[results[nid]]:
                    results[nid] = outcome
    rc = 98
    if child is not None:
        try:
            rc = child.wait(timeout=300)
        except subprocess.TimeoutExpired:
            child.kill()
            rc = child.wait()

    expected = declared_ids(xml_path)
    reason = None
    if not (valid and ended and declared == heard):
        reason = (
            "verdict stream refused (valid=%s ended=%s declared=%d heard=%d)"
            % (valid, ended, declared, heard)
        )
        print("[publish] %s; publishing every declared id as failed" % reason, flush=True)
        results, order = {}, []
    reported = {cls + "." + name for cls, name in results}
    missing = 0
    for joined in expected:
        if joined in reported:
            continue
        cls, _, name = joined.partition(".test.ts.")
        if _:
            cls = cls + ".test.ts"
        nid = (cls, name)
        order.append(nid)
        results[nid] = "failed"
        reported.add(joined)
        missing += 1

    esc = xml.sax.saxutils.quoteattr
    rows = []
    for nid in order:
        cls, name = nid
        status = results[nid]
        body = ""
        if status == "failed":
            message = reason or "failed; see the raw suite output in run.log"
            body = "<failure message=%s/>" % esc(message)
        elif status == "skipped":
            body = "<skipped/>"
        rows.append(
            "<testcase classname=%s name=%s>%s</testcase>"
            % (esc(cls), esc(name), body)
        )
    doc = (
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>"
        "<testsuite tests=\"%d\">%s</testsuite>" % (len(rows), "".join(rows))
    )
    with open(xml_path, "w") as fh:
        fh.write(doc)
    print(
        "[publish] wrote %s: %d cases (%d declared ids added as failed), child rc %s"
        % (xml_path, len(rows), missing, rc),
        flush=True,
    )


main()
PYPUB
# The run configuration the child loads. It says what the repository's own
# vitest.config.ts says (the test glob and the environment), and it lives in
# a sticky scratch directory because vite writes a bundled copy beside
# whatever config it loads, and nothing under /app or /verify is writable by
# the child. Root owns the file and the sticky bit keeps it in place; the
# repository's own file is still restored and digest-checked.
CONFIG_DIR="$SUITE_TMP/config"
mkdir -p "$CONFIG_DIR" 2>/dev/null || true
chmod 1777 "$CONFIG_DIR" 2>/dev/null || true
cat > "$CONFIG_DIR/vitest.config.mjs" <<'MJS'
export default {
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    cache: false,
  },
};
MJS
chmod 0444 "$VDIR/reporter.mjs" "$VDIR/publish.py" "$CONFIG_DIR/vitest.config.mjs" 2>/dev/null || true

# The digests live in this shell's memory, not in a file anything else can
# reach: the graded pass-to-pass sources and the run configuration at the
# base commit, and the held-back files as shipped.
P2P_SHA=$(cat <<'SHA_P2P'
601ed8f51c1fc74eebf677356fee86d4ef3121eaec650d979fbfe6f538fbf67b  tests/catalog/calibre.test.ts
b2a4f33ca1581b2d60ab3860df2b3d713ab716be2a786fd3632ad2735c01902c  tests/catalog/effect.test.ts
98d63968c342b38e236c0a7bc5821f1fa78f6b78203118af3cf8ec0fdaa0323e  tests/catalog/envelope.test.ts
f8a9e4385d962ab6be3276517668735db1ba2fdcbad3e5b9c936f5617365e266  tests/catalog/hazard.test.ts
54186191a17d03edfa237412276997308409aff39f16d6c79e566d7d520c25a9  tests/catalog/inventory.test.ts
2cc99a2a2a3cca479ab6518ee52cf0bccb386c013f0728dac0f4b80b8519d538  tests/catalog/lift.test.ts
321e57f1f88b425eef34ca51119bef27beea42870a2d942f39dfcb7f685e5dcc  tests/catalog/magazine.test.ts
1dfe5f4a7251a5fcbe31a0f867036a341f292db6278afb63eaad329d7dacccd4  tests/catalog/palette.test.ts
4200bee69d7663ed1f9f0d898b5cb481d1def77298d3519320f40c151ac25187  tests/catalog/parse.test.ts
b49315b089e9a1049d2bce8b75cb57aa2707171c3d8031bacfed2062b54173a2  tests/catalog/registry.test.ts
5d535a4bedbf98828726e32f9e7c1f19dd3999557661a5859ad78224f636d284  tests/catalog/substitute.test.ts
b3ad16c04fc0c62e691550238dcc76c418ae7006098e9976a8343f183f4f9c08  tests/catalog/timing.test.ts
d12e5c6fbd95dab9c89503a3f0613ce26609087965612a6467156c0fc52535fd  tests/catalog/validate.test.ts
28a416debb1d1e45cc730ca8ea02f578a3d6124884efdec8ddf75559576c1e21  tests/cli/args.test.ts
f65723f3de1292ee1410238eeab6906b08917cc92ffe8edc7a4832162183d8e5  tests/cli/command.test.ts
f68b8cb79e4bcab9a0b1db8c773f9d6802b4d58996fa1ac428058aa659abe843  tests/cli/commands.test.ts
9ad7e1a962257b4fc95cd2d0ae40b244ad1a18e1ee7f02b6772d924fc916c8da  tests/cli/completion.test.ts
0c06b70e3cfb31864b6f48cb61f799bfc748f0e22e937e3a492a1f2c662e5ffc  tests/cli/diffHazard.test.ts
c37a0e17f2c691f180845ab3ea357654804297fb30c251141b01ee875e02cf63  tests/cli/distance.test.ts
a29b0fd25b939db563ee58cb1f88f914e791dc7e15ae1c21ea20ba6ccc606a3e  tests/cli/label.test.ts
9f0dd991d20177c1eac9761a1ca1b33859837360711254e9a3ce8976d8db3d2d  tests/cli/lint.test.ts
00881db323f896e50ef3937dbc43c7ff354fc73fa24cbff48c096ea65e40a87b  tests/cli/permitContinuity.test.ts
b89a5d8dbc5db0b747357bf6eae328c3f51fb5cd81d6a5a54eaae1023cd3398e  tests/cli/planLayout.test.ts
cff9752c224e5e66bf6cde141c1c1141dceb60ca8d5e2a03ebc357c205da25c3  tests/cli/preview.test.ts
bb4b3ab8988b9fd4666c6b31fc5585f64f8698d01cf77b61adb0830c058d519d  tests/cli/sheetInventory.test.ts
dcf6c36d6c252b83513d90cde347a62897a25c75f528f22c5f780412c32c9e00  tests/compile.test.ts
c04c18197b2b3bd8ee0291515882dc08fdf61f3f672e3b2755d33a3fd970d151  tests/core/codes.test.ts
dcbed1ab10438943305f45f45ffb678886d165f68975029cd516c61e297acbb4  tests/core/collect.test.ts
a376fce049613ed3ab87627dbe8662ded4ba10e1b7f891fe84eb99c3e0b7a889  tests/core/csv.test.ts
a345460c386c892e32ac3ad91f7ba3118bcf2321e490b2cb9184d85edfafe626  tests/core/diagnostic.test.ts
cc32c21f30d6aea4146094edfbc17763a4911cb86ee614402e47517b6efffb89  tests/core/graph.test.ts
5ca870febdbfd71190ae4389fae72c342889a351d5aa642c9d7f6aa02a4fdfce  tests/core/ids.test.ts
1e3345cac3bc0dfd98dc6a12c5c83a0cea8fcfb8436a2bf2305ddfed88b7f2ca  tests/core/interval.test.ts
437c90d131e81896449a10b23ef4fd2bb16729b589ca02b1f4bd48026ffea95b  tests/core/numeric.test.ts
4ea46d1cde01dc4721b4423e6960f2a16a1d226f93e45a4992396843802b648e  tests/core/result.test.ts
38ac20d2b9f40a099ffb97c555cd632406599c0b6f22563c27eb7923808f4cbb  tests/core/rng.test.ts
14165d25720f4cf2f4ccf98dfd1b51a48f128e90fa48874fc7989d05b45aafed  tests/core/span.test.ts
7d4e7af84704a9ebb0611bc568bedacfcec81eeeb9c687b75349e4f0c7b7ff58  tests/core/text.test.ts
e441837a4413b03bd2e9998cd4966dcb9a1de398f604dcf0929a955b15c868ea  tests/core/timecode.test.ts
ce53f6a547dd876dcb3b9c45938a44ec17485f1af8424a13f8c6cb019bbf4a0e  tests/core/units.test.ts
5f73945026c27b4d197df1a5477f5713f7bfc9097516cf64ef57d695ee54ce24  tests/coverage.test.ts
555a7eec85693f99581a4b76e2aaf7f1c4352b99d1e3f7b3f13b24679051453b  tests/endToEnd.test.ts
8d691f9c439eefef05e054afbaf8340d1356e6ae755b34da7c25f6ef01e1adbd  tests/examples.test.ts
75bdaf540f4c68d1013b78343645b6dacbfba92a1456c428b87a0ac89565cb55  tests/export/explain.test.ts
e03628aa345929b80355ad09305c3a603cd4be5345b2d5a03e89edec9a2d970b  tests/export/firingTable.test.ts
116e8cdcac77b952fdc90b2df1335fe8c2549b03b83124f91e1b108d63736312  tests/export/json.test.ts
369f88e1e2ecf7e0430debd5607fa35d563e55a35e0c33eccd5a37b1e19ab011  tests/export/pack.test.ts
19c4896cd007ffddb97157b8b2d1ffb3ff4ef22d3f585191c7119cc901a55890  tests/export/permit.test.ts
710787c8ac2a8246030693862ef39bfb8a2dd1642c672203f5200a032fc8efcd  tests/export/sheets.test.ts
257d9745986684721d51965b2cc04cae0d130ed3cf696b4b01c3130afb069a8a  tests/export/siteplan.test.ts
f9e199429d44c354218fb7edaf49dcb999b4286af1f10884798fd3b30f19717d  tests/large.test.ts
1630a1480df544ddf529ae9113b5bd18d4d26fb9a48a05d67fdace5dc88121b8  tests/rig/allocate.test.ts
4f2ded3e4e32af7e8c738eead3fa7951e5a89442bd3884e09085b0aa5cc87fb8  tests/rig/circuit.test.ts
0b99e40461036c596bf7b5c5ad6dec3eb93129ce27c1f568aba95f3589a8c731  tests/rig/continuity.test.ts
2e581ef917239cbef7b585a7049aaee4f0980f42a509f9194489ddb2160f1af9  tests/rig/layout.test.ts
da5d499fe5f302da87cc81fe22cde063b2b4bd90f81fb9e14b5b1e73b0eea1b6  tests/rig/module.test.ts
71036c23986fbb2c08c479a5828f431eb883de32392163483ec00ff1e65e0533  tests/rig/parse.test.ts
8408fe1a5797f898ac1c75cb0875d5c39b1af0193b076ab17c661a39fabb766d  tests/rig/pin.test.ts
b638661708dc905ad3732ba463909c411bd4e5635ec7b90836ea0b5fb06f5920  tests/rig/redundancy.test.ts
f4380b9d362c2088b69ee98abc48dbaa01d12dbf040e7a1ca189b8f27aeb2342  tests/rig/rig.test.ts
d9175b042a2ddb7f7d00dbd5983ec5a0ba4e00845d43aae897680a3ce2d1b938  tests/rig/wiring.test.ts
4908e6c1771430cdd004c0d2664e9063ed4bf74b36fb1e8d132462e95e100f17  tests/robust.test.ts
b522b39f19376b75a3fa3d57bdf4e8a0cbd72352c1680358b94e1e8622223216  tests/safety/crowd.test.ts
b53cc7d31d5832eb5df99f8d97fb627b38c7a0f46490ee9596bdce407f5589f2  tests/safety/distance.test.ts
47627f2e30b55343391914973a24efcbbf40bee1d0baa27e85ad1798a2702502  tests/safety/noise.test.ts
a31424db0aea408c7ae2ffcdbc09029936d38789ed721557e12c6f9b2d0bad77  tests/safety/rules.test.ts
53d0e3f38c65d0dd13e397a0289dc8e342f5764797d4cf24551165bbb3821a8c  tests/safety/site.test.ts
05746dad11fce93a68aabf6310ca22faa921086a0a1af32c2139c6692df4f904  tests/safety/wind.test.ts
3e00971ab3bd371a602df7deacba78eb8fa490d42742c16d986fb8e778e08005  tests/script/annotate.test.ts
26774d0966f37dd665134027968c5b808afa0b3b911713eabd758203e38d0f1e  tests/script/ast.test.ts
35f444704c10d1e5e8a97f7f4d475b80ed9f2371d82069396202f7c62bb58374  tests/script/expand.test.ts
5f9e72d2e781854f89e2e4c3dcf9658120540611a9fb5920c909326ee7ab8e7a  tests/script/format.test.ts
02052cfcabcb3787dc020c0de3d661c8a45e678f533eb235f27459174bdeb616  tests/script/include.test.ts
9bd89b109f75da1b86b402f860e00949406984fa0c00c91c93c47467d9bf30eb  tests/script/lint.test.ts
6e9dd379d4f7b7098fe9e5646cee0fbaaa83ed0895b9ec09442373c6097c92f2  tests/script/parser.test.ts
f6f69238f46758ea1d57fe8f4a5fd689baa44c728d6792f564188187926e6454  tests/script/renumber.test.ts
ba792900869796f78b013b0e30cafc43e131097c380c2ed7c76590bf87acdfb6  tests/script/resolve.test.ts
7d21bb9cf6be80732d58a9e3ab359987dca160195f1ea34f069a0a2332e2c2e1  tests/script/token.test.ts
c6c483255b78219a41a54f60ec24d3715a1acdc43122b0c1d83ae8743875090b  tests/sim/preview.test.ts
a5ad2e12342770bd5a019431ef4f519344834aa65e28686f0ec54ec615623248  tests/sim/trajectory.test.ts
366880649f9a56edc73859f7747f326e72ac04f8186a928d8a21a8a7318ffd8b  tests/surface.test.ts
6e17a50e0c4923619500def534bdfb0855ef5eedd656f9074c5f336fd5af8224  tests/timeline/balance.test.ts
8193727b8f51fa12ceafba29ac31b97ad2f3858b590702b1f7889cd88fe4f0ba  tests/timeline/chain.test.ts
63acf7261d9096801dc0e08db4ebcd25205a7d9da2d1ffedf92398834297a955  tests/timeline/density.test.ts
58e4ba67134d8cc8114592433027bd8eaa7fb9c4b731ec7be35af68177a4cbbc  tests/timeline/diff.test.ts
5e0ca29fe8c55c5162609f4a4c29102423268697cb28755cd15ddfd38417a978  tests/timeline/load.test.ts
ee19a22e0c91322ff135d832a773870824e98e4dc286955057c16e24ad1da193  tests/timeline/misfire.test.ts
bc5ea8e9eae72b9fd54df6570b14c71ba9bd7aeb19777434bb18b1ecae47ed58  tests/timeline/quantise.test.ts
d227426d734bf99c471db8346e23065201e5cba39cadf6933fce04328ff9f9db  tests/timeline/rehearsal.test.ts
fa05485e56a0cca31113bf229f53275e700d2f2e16a183eaf4fe992c65e964dc  tests/timeline/schedule.test.ts
53cb2542b1687dc92108fb74e7aaa28af397d4640608798ecd743a8afac5a426  tests/timeline/sync.test.ts
329bf093cfa4728ed695e1594fb53a7260a4745ceb73254e4df4c27cfe1b8a01  tests/version.test.ts
cfa4551ae74e9e6d433dda267fdd6af5c7b4bb341d6ef8022e4ec9b2f7632a6a  vitest.config.ts
b7fdcae0ce899d8eae04ded16055ec7be55e7a93594221830bc4ed83cb763283  package.json
2a9aec112cbf6660d4d727407f9cf2cf335d9435efd89ea39be0dc12b77eb8b7  package-lock.json
9e7ab00c27a7c1ed6671e125b6e0494f1826976944cbaec4fa731195d5d5a5e3  tsconfig.json
SHA_P2P
)
NEW_SHA=$(cat <<'SHA_NEW'
b300f2fc51ec308fc22e2425da0fa4e0a3faae133af6b1ab0481ade6e994d3a1  tests/safety/siteGuard.ts
213c091feb1e1cb17ac2539d851e5a47245fce4cdd658a9ff355a6b28a99d7d2  tests/safety/siteSheet.test.ts
1bec0480e55770c6266a8038f166a4565de99244f526763f8edfac544538b995  tests/cli/siteFlags.test.ts
SHA_NEW
)

# Dependencies are the image's. A patch that ships its own copy of a
# package, a workspace file that would redefine the run, an npm config that
# injects node options, or a vitest setup file is not a submission the
# suites can be trusted on.
refused=""
if [ -s "$MODEL_PATCH" ]; then
  for _p in $(python3 /tests/grader.py patch-paths "$MODEL_PATCH"); do
    case "$_p" in
      node_modules/*|*/node_modules/*|.npmrc|vitest.workspace.*|vite.config.*|tests/setup*|.env|.env.*)
        refused="$refused $_p" ;;
    esac
  done
fi

# HEAD in this container is the base commit; model.patch and test.patch
# touch the working tree only. The whole base test tree and the run
# configuration go back to what the repository shipped, and anything else
# under tests/ that is not a held-back file goes.
restore_base() {
  for f in $P2P_FILES $CONFIG_FILES; do
    git -C /app checkout -q HEAD -- "$f" 2>/dev/null || true
  done
  find /app/tests -type f \( -name '*.ts' -o -name '*.js' -o -name '*.mjs' -o -name '*.cjs' -o -name '*.json' \) 2>/dev/null | while read -r _f; do
    _rel="${_f#/app/}"
    case " $P2P_FILES $NEW_FILES " in *" $_rel "*) ;; *) rm -f "$_f" ;; esac
  done
  rm -rf /app/dist /app/coverage /app/node_modules/.vite /app/node_modules/.vite-temp 2>/dev/null || true
}
p2p_matches() { printf '%s\n' "$P2P_SHA" | (cd /app && sha256sum -c - >/dev/null 2>&1); }
new_matches() { printf '%s\n' "$NEW_SHA" | (cd /app && sha256sum -c - >/dev/null 2>&1); }
log_mismatch() { printf '%s\n' "$1" | (cd /app && sha256sum -c - 2>&1 | grep -v ': OK$' | head -20) >> "$RUN_LOG" 2>/dev/null || true; }

restore_base
P2P_OK=1
if ! p2p_matches; then
  P2P_OK=0
  log "ERROR: pass-to-pass sources or the run configuration do not match the base commit and could not be restored; their suite will not run and every pass-to-pass id will be published as failed"
  log_mismatch "$P2P_SHA"
fi
NEW_OK=1
if new_matches; then
  for f in $NEW_FILES; do
    mkdir -p "$KEEP/$(dirname "$f")" 2>/dev/null || true
    cp "/app/$f" "$KEEP/$f" 2>/dev/null || true
  done
else
  NEW_OK=0
  log "ERROR: held-back test sources are not the ones shipped; their suite will not run and every fail-to-pass id will be published as failed"
  log_mismatch "$NEW_SHA"
fi
if [ -n "$refused" ]; then
  P2P_OK=0
  NEW_OK=0
  log "ERROR: model.patch touches$refused; every declared id will report failed"
fi
if [ ! -f /app/node_modules/vitest/vitest.mjs ]; then
  P2P_OK=0
  NEW_OK=0
  log "ERROR: node_modules/vitest is missing from the image; every declared id will report failed"
fi

# The child must be able to read the tree and write nothing in it. vite
# bundles a TypeScript config into node_modules/.vite-temp and keeps a cache
# under node_modules/.vite, so those two live in the scratch directory
# through symlinks the child can write behind and nothing else can.
chmod -R a+rX /app 2>/dev/null || true
rm -rf /app/node_modules/.vite /app/node_modules/.vite-temp 2>/dev/null || true
mkdir -p "$SUITE_TMP/vite" "$SUITE_TMP/vite-temp" 2>/dev/null || true
chmod 1777 "$SUITE_TMP/vite" "$SUITE_TMP/vite-temp" 2>/dev/null || true
ln -s "$SUITE_TMP/vite" /app/node_modules/.vite 2>/dev/null || true
ln -s "$SUITE_TMP/vite-temp" /app/node_modules/.vite-temp 2>/dev/null || true

chmod -R go-rwx "$KEEP" 2>/dev/null || true
chmod 0700 "$RPTDIR" "$KEEP" 2>/dev/null || true
chmod 0555 "$VDIR" 2>/dev/null || true

proc_list() { ls /proc 2>/dev/null | grep -E '^[0-9]+$'; }
PROC_BEFORE=$(proc_list)
SELF_CHAIN=" $$ "
_p=$PPID
while [ -n "${_p:-}" ] && [ "$_p" != "0" ] && [ "$_p" != "1" ]; do
  SELF_CHAIN="$SELF_CHAIN$_p "
  _p=$(awk '{print $4}' "/proc/$_p/stat" 2>/dev/null)
done
sweep() {
  for _pid in $(proc_list); do
    echo "$PROC_BEFORE" | grep -qx "$_pid" && continue
    case "$SELF_CHAIN" in *" $_pid "*) continue ;; esac
    kill -9 "$_pid" 2>/dev/null || true
  done
}

run_suite() {
  _xml="$1"; shift
  echo "+ vitest -> $_xml ($# files)" >> "$RUN_LOG" 2>/dev/null || true
  if command -v setsid >/dev/null 2>&1; then
    setsid timeout 1200 python3 -I "$VDIR/publish.py" "$VDIR" "$_xml" "$@" >> "$RUN_LOG" 2>&1 &
    _pid=$!
    wait "$_pid" 2>/dev/null
    _rc=$?
    kill -9 -- "-$_pid" 2>/dev/null || true
  else
    timeout 1200 python3 -I "$VDIR/publish.py" "$VDIR" "$_xml" "$@" >> "$RUN_LOG" 2>&1
    _rc=$?
  fi
  echo "+ suite exit $_rc" >> "$RUN_LOG" 2>/dev/null || true
}

set +e
if [ "$P2P_OK" = 1 ]; then
  run_suite "$RPTDIR/base.xml" $P2P_FILES
fi

# Between the suites: nothing from the first may still be running, and
# everything the second reads is put back and checked again.
sweep
if [ "$NEW_OK" = 1 ]; then
  restore_base
  for f in $NEW_FILES; do
    cp "$KEEP/$f" "/app/$f" 2>/dev/null || true
  done
  chmod -R a+rX /app/tests 2>/dev/null || true
  if ! new_matches; then
    NEW_OK=0
    log "ERROR: held-back test sources were altered during the pass-to-pass suite and could not be restored; their suite will not run and every fail-to-pass id will be published as failed"
    log_mismatch "$NEW_SHA"
  elif ! p2p_matches; then
    NEW_OK=0
    log "ERROR: pass-to-pass sources or the run configuration were altered during their suite and could not be restored; the held-back suite will not run and every fail-to-pass id will be published as failed"
    log_mismatch "$P2P_SHA"
  else
    echo "+ held-back files and run configuration re-checked before their suite: OK" >> "$RUN_LOG" 2>/dev/null || true
  fi
fi
if [ "$NEW_OK" = 1 ]; then
  run_suite "$RPTDIR/new.xml" $NEW_RUN
fi
sweep

# Publish the reports read-only, only after the sweep. A refused run has no
# report yet: publish every declared id as failed rather than nothing.
if [ ! -f "$RPTDIR/base.xml" ]; then
  python3 -I - "$RPTDIR/base.xml" <<'PYEMPTY' >> "$RUN_LOG" 2>&1
import json, sys, xml.sax.saxutils
path = sys.argv[1]
key = "p2p_node_ids" if path.endswith("base.xml") else "f2p_node_ids"
try:
    ids = json.load(open("/tests/config.json")).get(key, [])
except Exception:
    ids = []
rows = []
for joined in ids:
    cls, sep, name = joined.partition(".test.ts.")
    if sep:
        cls += ".test.ts"
    rows.append('<testcase classname=%s name=%s><failure message="suite refused; see run.log"/></testcase>'
                % (xml.sax.saxutils.quoteattr(cls), xml.sax.saxutils.quoteattr(name)))
open(path, "w").write('<?xml version="1.0" encoding="utf-8"?><testsuite tests="%d">%s</testsuite>' % (len(rows), "".join(rows)))
PYEMPTY
fi
if [ ! -f "$RPTDIR/new.xml" ]; then
  python3 -I - "$RPTDIR/new.xml" <<'PYEMPTY' >> "$RUN_LOG" 2>&1
import json, sys, xml.sax.saxutils
path = sys.argv[1]
key = "p2p_node_ids" if path.endswith("base.xml") else "f2p_node_ids"
try:
    ids = json.load(open("/tests/config.json")).get(key, [])
except Exception:
    ids = []
rows = []
for joined in ids:
    cls, sep, name = joined.partition(".test.ts.")
    if sep:
        cls += ".test.ts"
    rows.append('<testcase classname=%s name=%s><failure message="suite refused; see run.log"/></testcase>'
                % (xml.sax.saxutils.quoteattr(cls), xml.sax.saxutils.quoteattr(name)))
open(path, "w").write('<?xml version="1.0" encoding="utf-8"?><testsuite tests="%d">%s</testsuite>' % (len(rows), "".join(rows)))
PYEMPTY
fi
cp "$RPTDIR/base.xml" "$BASE_REPORT" 2>/dev/null || true
cp "$RPTDIR/new.xml" "$NEW_REPORT" 2>/dev/null || true
chmod 0444 "$BASE_REPORT" "$NEW_REPORT" 2>/dev/null || true
# >>> END RUN TESTS <<<

# Surface raw suite output into stdout (the harness captures it) so failures
# stay debuggable even when a framework report omits the reason.
_seen=""
for _rl in "$RUN_LOG" /logs/verifier/*_run.log /logs/verifier/*-run.log /logs/verifier/*.log /logs/verifier/*.out; do
  [ -f "$_rl" ] && [ -s "$_rl" ] || continue
  case " $_seen " in *" $_rl "*) continue ;; esac
  case "${_rl##*/}" in *convert*.log|ctrf*.log|junit*.log) continue ;; esac
  _seen="$_seen $_rl"
  echo "===== raw suite output: ${_rl##*/} ====="
  cat "$_rl"
done 2>/dev/null
echo "===== grade ====="

python3 /tests/grader.py grade
log "reward.json=$(cat /logs/verifier/reward.json 2>/dev/null)"

# Uniform top level: keep only the canonical artifacts in /logs/verifier and
# move every framework-native report/log under reports/.
mkdir -p /logs/verifier/reports 2>/dev/null
for _f in /logs/verifier/*; do
  case "${_f##*/}" in
    reward.json|reward.txt|ctrf.json|run.log|test-stdout.txt|reports) continue ;;
  esac
  [ -f "$_f" ] && mv -f "$_f" /logs/verifier/reports/ 2>/dev/null
done
