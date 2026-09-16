#!/usr/bin/env python3
"""Verifier grader: patch preparation and JUnit-report grading.

Called by test.sh as:

    python3 /tests/grader.py prepare   # before the suites run
    python3 /tests/grader.py grade     # after the suites have written reports

prepare
    * applies the candidate patch (model.patch) to /app when one is present
      and not already applied; a patch that cannot be applied grades 0;
    * restores the frozen files (the existing test suite and pyproject.toml)
      with git when git is available, otherwise leaves them in place and
      relies on the sha256 pins checked at grade time;
    * removes root-level pytest configuration files that do not exist at the
      base commit (conftest.py, pytest.ini, tox.ini, setup.cfg) so no
      injected plugin or hook can alter how the suites are collected;
    * writes every held-out test file from /tests/test.patch directly, so the
      graded tests are always exactly the ones this bundle carries.

grade
    * re-verifies the sha256 pins of the held-out files and the frozen files;
    * parses the JUnit reports named in /tests/config.json;
    * a graded id absent from every report, or reported with two conflicting
      terminal verdicts, counts as failed;
    * reward is 1 only when every fail-to-pass id and every pass-to-pass id
      passed; the verdict is written to /logs/verifier/reward.json.

Everything degrades rather than refuses: a missing tool or an unwritable
path is logged and worked around; only genuine grading conditions (patch
does not apply, pinned file tampered, graded test failed) cost reward.
"""

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys

APP = "/app"
TESTS = "/tests"
OUT = "/logs/verifier"
CONFIG = os.path.join(TESTS, "config.json")

# Candidate locations for the model patch, in search order.  The platform's
# pre_artifacts.sh captures the committed work as /logs/artifacts/model.patch.
MODEL_PATCH_PATHS = [
    os.environ.get("MODEL_PATCH", ""),
    "/logs/artifacts/model.patch",
    "/app/model.patch",
    "/solution/model.patch",
    "/logs/model.patch",
    "/model.patch",
    "/tmp/model.patch",
]

# Root-level files that do not exist at the base commit but would change
# how pytest collects and runs if a candidate created them.
PROTECTED_ABSENT = ["conftest.py", "pytest.ini", "tox.ini", "setup.cfg"]


def log(msg):
    print("[grader] %s" % msg, flush=True)


def read_config():
    with open(CONFIG, "r", encoding="utf-8") as fh:
        return json.load(fh)


def sha256_file(path):
    h = hashlib.sha256()
    try:
        with open(path, "rb") as fh:
            for chunk in iter(lambda: fh.read(65536), b""):
                h.update(chunk)
    except OSError:
        return None
    return h.hexdigest()


def write_reward(payload):
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "reward.json"), "w", encoding="utf-8") as fh:
        json.dump(payload, fh, separators=(",", ":"), sort_keys=True)
        fh.write("\n")


# ---------------------------------------------------------------------------
# Unified-diff parsing and application (no git required)
# ---------------------------------------------------------------------------

class Hunk:
    def __init__(self, old_start, old_len, new_start, new_len, lines):
        self.old_start = old_start
        self.old_len = old_len
        self.new_start = new_start
        self.new_len = new_len
        self.lines = lines  # list of (tag, text), tag in ' +-'


class FilePatch:
    def __init__(self, old_path, new_path):
        self.old_path = old_path  # None => file added
        self.new_path = new_path  # None => file deleted
        self.hunks = []


_HUNK_RE = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")


def _strip_prefix(path):
    if path in ("/dev/null", None):
        return None
    if path.startswith("a/") or path.startswith("b/"):
        return path[2:]
    return path


_DIFF_GIT_RE = re.compile(r'^diff --git a/(.*) b/(.*)$')


def parse_patch(text):
    """Parse a git-style unified diff into a list of FilePatch objects.

    Handles hunk-less entries too: an empty added file ("new file mode"
    with no ---/+++ lines) still materialises, and an empty deleted file
    is still removed.
    """
    patches = []
    cur = None
    old_name = new_name = None
    pending = None  # (old, new) from a 'diff --git' header not yet resolved
    pending_kind = None  # 'new' | 'del' | None

    def flush_pending():
        nonlocal pending, pending_kind
        if pending is not None and pending_kind is not None:
            if pending_kind == "new":
                patches.append(FilePatch(None, pending[1]))
            else:
                patches.append(FilePatch(pending[0], None))
        pending = pending_kind = None

    lines = text.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        if line.startswith("diff --git "):
            flush_pending()
            cur = None
            old_name = new_name = None
            m = _DIFF_GIT_RE.match(line)
            if m:
                pending = (m.group(1), m.group(2))
        elif line.startswith("new file mode"):
            pending_kind = "new"
        elif line.startswith("deleted file mode"):
            pending_kind = "del"
        elif line.startswith("--- "):
            old_name = _strip_prefix(line[4:].split("\t")[0])
        elif line.startswith("+++ "):
            new_name = _strip_prefix(line[4:].split("\t")[0])
            cur = FilePatch(old_name, new_name)
            patches.append(cur)
            pending = pending_kind = None  # block has real content lines
        else:
            m = _HUNK_RE.match(line)
            if m and cur is not None:
                old_start = int(m.group(1))
                old_len = int(m.group(2) or "1")
                new_start = int(m.group(3))
                new_len = int(m.group(4) or "1")
                hunk = Hunk(old_start, old_len, new_start, new_len, [])
                need_old = old_len
                need_new = new_len
                i += 1
                while i < len(lines) and (need_old > 0 or need_new > 0):
                    raw = lines[i]
                    if raw.startswith("\\"):  # "\ No newline at end of file"
                        i += 1
                        continue
                    tag, text_line = (raw[0], raw[1:]) if raw else (" ", "")
                    if tag == " ":
                        need_old -= 1
                        need_new -= 1
                    elif tag == "-":
                        need_old -= 1
                    elif tag == "+":
                        need_new -= 1
                    else:
                        break
                    hunk.lines.append((tag, text_line))
                    i += 1
                cur.hunks.append(hunk)
                continue
        i += 1
    flush_pending()
    return patches


def _apply_file_patch(fp, root, check_only=False):
    """Apply one FilePatch under *root*. Returns None on success, else error."""
    if fp.old_path is None:
        # New file: content is the + lines of the single hunk run.
        content = "\n".join(t for tag, t in
                            [l for h in fp.hunks for l in h.lines] if tag == "+")
        if any(h.lines for h in fp.hunks):
            content += "\n"
        dest = os.path.join(root, fp.new_path)
        if os.path.exists(dest):
            return "add target already exists: %s" % fp.new_path
        if not check_only:
            os.makedirs(os.path.dirname(dest) or root, exist_ok=True)
            with open(dest, "w", encoding="utf-8") as fh:
                fh.write(content)
        return None

    src = os.path.join(root, fp.old_path)
    try:
        with open(src, "r", encoding="utf-8") as fh:
            old_lines = fh.read().splitlines()
    except OSError:
        return "missing file: %s" % fp.old_path

    if fp.new_path is None:
        if not check_only:
            os.remove(src)
        return None

    new_lines = []
    cursor = 0  # index into old_lines
    for hunk in fp.hunks:
        expect_old = [t for tag, t in hunk.lines if tag in (" ", "-")]
        start = hunk.old_start - 1 if hunk.old_len > 0 else hunk.old_start
        # Tolerate small offsets: search near the declared position.
        found = None
        for delta in range(0, len(old_lines) + 1):
            for pos in (start - delta, start + delta):
                if pos < cursor or pos + len(expect_old) > len(old_lines) or pos < 0:
                    continue
                if old_lines[pos:pos + len(expect_old)] == expect_old:
                    found = pos
                    break
            if found is not None:
                break
        if found is None and not expect_old:
            found = min(start, len(old_lines))
        if found is None:
            return "hunk does not apply at %s:%d" % (fp.old_path, hunk.old_start)
        new_lines.extend(old_lines[cursor:found])
        idx = found
        for tag, text_line in hunk.lines:
            if tag == " ":
                new_lines.append(old_lines[idx])
                idx += 1
            elif tag == "-":
                idx += 1
            else:
                new_lines.append(text_line)
        cursor = idx
    new_lines.extend(old_lines[cursor:])
    if not check_only:
        dest = os.path.join(root, fp.new_path)
        os.makedirs(os.path.dirname(dest) or root, exist_ok=True)
        with open(dest, "w", encoding="utf-8") as fh:
            fh.write("\n".join(new_lines) + ("\n" if new_lines else ""))
        if fp.new_path != fp.old_path:
            os.remove(src)
    return None


def apply_patch_text(text, root, check_only=False):
    """Apply a unified diff. Returns None on success, else the first error."""
    for fp in parse_patch(text):
        err = _apply_file_patch(fp, root, check_only=check_only)
        if err:
            return err
    return None


def patch_already_applied(text, root):
    """Heuristic reverse check: every added file exists with matching tail
    content and every removed line is gone from its file."""
    for fp in parse_patch(text):
        if fp.old_path is None:
            dest = os.path.join(root, fp.new_path)
            if not os.path.exists(dest):
                return False
        else:
            src = os.path.join(root, fp.old_path)
            if not os.path.exists(src):
                continue
            try:
                with open(src, "r", encoding="utf-8") as fh:
                    body = fh.read().splitlines()
            except OSError:
                return False
            for hunk in fp.hunks:
                expect_new = [t for tag, t in hunk.lines if tag in (" ", "+")]
                if expect_new and not _contains_run(body, expect_new):
                    return False
    return True


def _contains_run(haystack, needle):
    n = len(needle)
    return any(haystack[i:i + n] == needle for i in range(len(haystack) - n + 1))


# ---------------------------------------------------------------------------
# prepare
# ---------------------------------------------------------------------------

def git_available():
    try:
        subprocess.run(["git", "-C", APP, "rev-parse", "--git-dir"],
                       capture_output=True, timeout=30, check=True)
        return True
    except Exception:
        return False


def cmd_prepare():
    cfg = read_config()
    os.makedirs(OUT, exist_ok=True)

    # 1. Apply the candidate patch when present.
    patch_path = next((p for p in MODEL_PATCH_PATHS
                       if p and os.path.isfile(p) and os.path.getsize(p) > 0), None)
    if patch_path:
        with open(patch_path, "r", encoding="utf-8", errors="replace") as fh:
            patch_text = fh.read()
        err = apply_patch_text(patch_text, APP, check_only=True)
        if err is None:
            apply_patch_text(patch_text, APP)
            log("applied candidate patch from %s" % patch_path)
        elif patch_already_applied(patch_text, APP):
            log("candidate patch already applied; skipping (%s)" % patch_path)
        else:
            log("ERROR: candidate patch does not apply: %s" % err)
            write_reward({"reward": 0, "error": "model patch failed to apply",
                          "detail": err})
            return 0
    else:
        log("no candidate patch found; grading /app as it stands")

    # 2. Restore frozen files with git when possible.
    frozen = cfg.get("frozen_files", {})
    if git_available():
        paths = sorted(frozen)
        if paths:
            subprocess.run(["git", "-C", APP, "checkout", "--"] + paths,
                           capture_output=True, timeout=60)
            log("restored %d frozen files via git" % len(paths))
    else:
        log("git unavailable; frozen files verified by sha256 only")

    # 3. Drop pytest-config files that do not exist at the base commit.
    for name in cfg.get("protected_absent", PROTECTED_ABSENT):
        path = os.path.join(APP, name)
        if os.path.exists(path):
            try:
                os.remove(path)
                log("removed foreign root file %s" % name)
            except OSError as exc:
                log("WARNING: could not remove %s: %s" % (name, exc))

    # 4. Write the held-out test files from the bundle's own patch.
    tp_path = os.path.join(TESTS, "test.patch")
    with open(tp_path, "r", encoding="utf-8") as fh:
        test_patch = parse_patch(fh.read())
    written = 0
    for fp in test_patch:
        if fp.new_path is None:
            continue
        content = "\n".join(t for tag, t in
                            [l for h in fp.hunks for l in h.lines] if tag == "+")
        if any(h.lines for h in fp.hunks):
            content += "\n"
        dest = os.path.join(APP, fp.new_path)
        os.makedirs(os.path.dirname(dest) or APP, exist_ok=True)
        with open(dest, "w", encoding="utf-8") as fh:
            fh.write(content)
        written += 1
    log("wrote %d held-out test files" % written)

    # 5. Sanity-check the pins we can already check.
    bad = verify_pins(cfg.get("held_out_files", {}))
    if bad:
        log("WARNING: held-out pin mismatch after write: %s" % ", ".join(bad))
    return 0


def verify_pins(pins):
    bad = []
    for rel, want in sorted(pins.items()):
        got = sha256_file(os.path.join(APP, rel))
        if got != want:
            bad.append(rel)
    return bad


# ---------------------------------------------------------------------------
# grade
# ---------------------------------------------------------------------------

def parse_junit(path):
    """Return {id: 'pass'|'fail'} for one JUnit XML report."""
    import xml.etree.ElementTree as ET
    results = {}
    try:
        root = ET.parse(path).getroot()
    except Exception as exc:
        log("WARNING: cannot parse %s: %s" % (path, exc))
        return results
    for case in root.iter("testcase"):
        cls = case.get("classname") or ""
        name = case.get("name") or ""
        tid = "%s.%s" % (cls, name) if cls else name
        verdict = "pass"
        for child in case:
            if child.tag in ("failure", "error", "skipped"):
                verdict = "fail"
                break
        prev = results.get(tid)
        if prev is not None and prev != verdict:
            verdict = "fail"  # conflicting terminal verdicts count as failed
        results[tid] = verdict
    return results


def cmd_grade():
    cfg = read_config()
    f2p = [str(x) for x in cfg.get("f2p_node_ids", [])]
    p2p = [str(x) for x in cfg.get("p2p_node_ids", [])]

    problems = []
    bad_held = verify_pins(cfg.get("held_out_files", {}))
    if bad_held:
        problems.append("held-out files altered: %s" % ", ".join(bad_held))
    bad_frozen = verify_pins(cfg.get("frozen_files", {}))
    if bad_frozen:
        problems.append("frozen suite files altered: %s" % ", ".join(bad_frozen))

    results = {}
    for report in cfg.get("grade", {}).get("reports", []):
        for tid, verdict in parse_junit(report).items():
            prev = results.get(tid)
            if prev is not None and prev != verdict:
                verdict = "fail"
            results[tid] = verdict

    def tally(ids):
        passed = [i for i in ids if results.get(i) == "pass"]
        absent = [i for i in ids if i not in results]
        return passed, absent

    f2p_pass, f2p_absent = tally(f2p)
    p2p_pass, p2p_absent = tally(p2p)

    ok = (not problems and len(f2p_pass) == len(f2p)
          and len(p2p_pass) == len(p2p) and f2p and p2p)
    payload = {
        "reward": 1 if ok else 0,
        "f2p_passed": len(f2p_pass), "f2p_total": len(f2p),
        "f2p_absent": len(f2p_absent),
        "p2p_passed": len(p2p_pass), "p2p_total": len(p2p),
        "p2p_absent": len(p2p_absent),
    }
    if problems:
        payload["integrity"] = problems
        log("ERROR: %s" % "; ".join(problems))
    write_reward(payload)
    log("f2p %d/%d (absent %d), p2p %d/%d (absent %d), reward %d" % (
        len(f2p_pass), len(f2p), len(f2p_absent),
        len(p2p_pass), len(p2p), len(p2p_absent), payload["reward"]))
    return 0


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in ("prepare", "grade"):
        log("usage: grader.py prepare|grade")
        return 2
    return cmd_prepare() if sys.argv[1] == "prepare" else cmd_grade()


if __name__ == "__main__":
    sys.exit(main())
