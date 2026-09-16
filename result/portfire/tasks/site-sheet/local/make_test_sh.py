#!/usr/bin/env python3
"""Generate tests/test.sh for site-sheet from the frozen frame.

Reads the frame as pulled from the draft (local/frame.sh, kept verbatim),
replaces only the block between the RUN TESTS markers, and asserts every byte
outside the markers is unchanged before writing. The digest pins come from
the trees on disk: the pass-to-pass sources and the run configuration from
the pristine base checkout, the held-back files from held-out/.

    ./make_test_sh.py
"""

from __future__ import annotations

import hashlib
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
TASK = HERE.parent
REPO = TASK.parent.parent / "repo"
HELD_OUT = TASK / "held-out"

FRAME = (HERE / "frame.sh").read_text()
BEGIN = "# >>> RUN TESTS (task-specific) <<<\n"
END = "# >>> END RUN TESTS <<<\n"

# Every test file the repository ships at the base commit, and the files that
# decide how vitest finds, loads and asserts them.
P2P_FILES = sorted(
    str(p.relative_to(REPO)) for p in (REPO / "tests").rglob("*.test.ts")
)
CONFIG_FILES = [
    "vitest.config.ts",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
]
NEW_FILES = [
    "tests/safety/siteGuard.ts",
    "tests/safety/siteSheet.test.ts",
    "tests/cli/siteFlags.test.ts",
]
NEW_RUN = [f for f in NEW_FILES if f.endswith(".test.ts")]


def sha_lines(root: pathlib.Path, files: list[str]) -> str:
    lines = []
    for f in files:
        digest = hashlib.sha256((root / f).read_bytes()).hexdigest()
        lines.append(f"{digest}  {f}")
    return "\n".join(lines)


BLOCK = r'''# >>> RUN TESTS (task-specific) <<<
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
BASE=@BASE@
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

P2P_FILES="@P2P_FILES@"
CONFIG_FILES="@CONFIG_FILES@"
NEW_FILES="@NEW_FILES@"
NEW_RUN="@NEW_RUN@"

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
@P2P_SHA@
SHA_P2P
)
NEW_SHA=$(cat <<'SHA_NEW'
@NEW_SHA@
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
'''


def main() -> None:
    base = (TASK / "tests" / "config.json").read_text()
    import json

    base_sha = json.loads(base)["base_commit"]
    p2p_sha = sha_lines(REPO, P2P_FILES + CONFIG_FILES)
    new_sha = sha_lines(HELD_OUT, NEW_FILES)
    block = (
        BLOCK.replace("@BASE@", base_sha)
        .replace("@P2P_FILES@", " ".join(P2P_FILES))
        .replace("@CONFIG_FILES@", " ".join(CONFIG_FILES))
        .replace("@NEW_FILES@", " ".join(NEW_FILES))
        .replace("@NEW_RUN@", " ".join(NEW_RUN))
        .replace("@P2P_SHA@", p2p_sha)
        .replace("@NEW_SHA@", new_sha)
    )
    begin = FRAME.index(BEGIN)
    end = FRAME.index(END) + len(END)
    head, tail = FRAME[:begin], FRAME[end:]
    out = head + block + tail
    assert out.count(BEGIN) == 1 and out.count(END) == 1
    assert out[:begin] == FRAME[:begin]
    assert out[out.index(END) + len(END):] == FRAME[end:]
    target = TASK / "tests" / "test.sh"
    target.write_text(out)
    target.chmod(0o755)
    print(f"wrote {target} ({len(out)} bytes), {len(P2P_FILES)} p2p files pinned")


if __name__ == "__main__":
    main()
