"""Turn one child's verdict stream into the JUnit report grading reads.

This process never imports anything from /app. It owns the token, the pipe
and the file, and it publishes every id config.json declares for the report,
so a refused stream, a crashed child or a case that never ran all land as a
failure with a reason rather than as a missing entry.
"""

import json
import os
import subprocess
import sys
from xml.sax.saxutils import escape, quoteattr


RANK = {"passed": 0, "skipped": 1, "failed": 2}


def declared_ids(xml_path):
    """The ids this report is graded on, read from the verifier's own config."""
    try:
        with open("/tests/config.json") as handle:
            config = json.load(handle)
    except Exception:
        return []
    key = "p2p_node_ids" if os.path.basename(xml_path) == "base.xml" else "f2p_node_ids"
    return [nid for nid in config.get(key, []) if isinstance(nid, str)]


def drop_privileges():
    """Become nobody, for when the shell had no setpriv to do it."""
    try:
        import pwd
        entry = pwd.getpwnam("nobody")
        uid, gid = entry.pw_uid, entry.pw_gid
    except Exception:
        uid, gid = 65534, 65534

    def apply():
        os.setgroups([])
        os.setgid(gid)
        os.setuid(uid)
        if os.getuid() != uid or os.geteuid() != uid:
            os._exit(97)

    return apply


def start_child(vdir, scratch, labels, write_fd):
    runas = os.environ.get("RUNAS", "").split()
    preexec = None
    if not runas and os.geteuid() == 0:
        preexec = drop_privileges()
        print("[publish] no setpriv; dropping the child to nobody here", flush=True)
    argv = runas + [
        sys.executable, "-I", "-B", os.path.join(vdir, "child.py"), str(write_fd),
    ] + labels
    return subprocess.Popen(
        argv,
        stdin=subprocess.PIPE,
        pass_fds=(write_fd,),
        preexec_fn=preexec,
        cwd="/app",
        env={
            "PATH": "/usr/local/bin:/usr/bin:/bin",
            "TMPDIR": scratch,
            "HOME": scratch,
            "LC_ALL": "C.UTF-8",
            "SBOT_OFFLINE": "1",
            "DJANGO_SETTINGS_MODULE": "SchwabOptionBot.settings",
        },
    )


def read_stream(read_fd, token):
    """Collect verdicts, and say whether the stream may be believed."""
    results = {}
    heard = 0
    ended = False
    valid = True
    counted = -1
    with os.fdopen(read_fd, "r", errors="replace") as stream:
        for raw in stream:
            line = raw.rstrip("\n")
            if ended:
                # Nothing may follow END. A late line poisons the stream.
                valid = False
                break
            parts = line.split(" ", 3)
            if len(parts) == 3 and parts[0] == "END" and parts[1] == token:
                ended = True
                counted = int(parts[2]) if parts[2].isdigit() else -1
                continue
            if len(parts) == 4 and parts[0] == "V" and parts[1] == token:
                outcome, payload = parts[2], parts[3]
                if outcome not in RANK or "\x1f" not in payload:
                    valid = False
                    break
                classname, _, name = payload.partition("\x1f")
                nid = "%s.%s" % (classname, name)
                heard += 1
                if nid not in results or RANK[outcome] > RANK[results[nid]]:
                    results[nid] = outcome
            # Untokenised lines are ignored. Only the child was given a token.
    return results, heard, ended, valid, counted


def write_report(path, rows):
    failures = sum(1 for _, status, _ in rows if status != "passed")
    out = ['<?xml version="1.0" encoding="utf-8"?>']
    out.append(
        '<testsuite name=%s tests="%d" failures="%d" errors="0" skipped="0">'
        % (quoteattr(os.path.basename(path)), len(rows), failures)
    )
    for nid, status, note in rows:
        classname, _, name = nid.rpartition(".")
        out.append(
            "  <testcase classname=%s name=%s>" % (quoteattr(classname), quoteattr(name))
        )
        if status != "passed":
            out.append(
                '    <failure message=%s>%s</failure>'
                % (quoteattr(note or status), escape(note or status))
            )
        out.append("  </testcase>")
    out.append("</testsuite>")
    with open(path, "w") as handle:
        handle.write("\n".join(out) + "\n")


def main():
    vdir, scratch, xml_path = sys.argv[1], sys.argv[2], sys.argv[3]
    labels = sys.argv[4:]
    token = os.urandom(16).hex()
    read_fd, write_fd = os.pipe()
    try:
        child = start_child(vdir, scratch, labels, write_fd)
    except Exception as exc:
        print("[publish] could not start the child (%s)" % exc, flush=True)
        child = None
    os.close(write_fd)
    if child is not None:
        child.stdin.write((token + "\n").encode())
        child.stdin.flush()
        child.stdin.close()
        results, heard, ended, valid, counted = read_stream(read_fd, token)
        rc = child.wait()
    else:
        os.close(read_fd)
        results, heard, ended, valid, counted, rc = {}, 0, False, False, -1, 98

    reason = None
    if not (valid and ended and counted == heard):
        reason = (
            "verdict stream refused (valid=%s ended=%s counted=%d heard=%d rc=%s)"
            % (valid, ended, counted, heard, rc)
        )
        print("[publish] %s" % reason, flush=True)
        results = {}

    rows = []
    passed = 0
    for nid in declared_ids(xml_path):
        status = results.get(nid)
        if status == "passed":
            rows.append((nid, "passed", ""))
            passed += 1
        elif status is None:
            rows.append((nid, "failed", reason or "the run reported no result for this test"))
        else:
            rows.append((nid, "failed", "reported %s" % status))
    write_report(xml_path, rows)
    print(
        "[publish] %s: %d of %d declared passed (%d verdicts heard)"
        % (os.path.basename(xml_path), passed, len(rows), heard),
        flush=True,
    )


main()
