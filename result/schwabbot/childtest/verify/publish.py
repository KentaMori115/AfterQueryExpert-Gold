import json
import os
import pwd
import shutil
import subprocess
import sys
import xml.sax.saxutils


def declared_ids(xml_path):
    """The ids the grading configuration declares for this report.

    A refused or incomplete run still publishes every one of them, failed, so
    an empty report can never be mistaken for a verifier that fell over.
    """
    try:
        with open("/tests/config.json") as handle:
            config = json.load(handle)
    except Exception:
        return []
    key = "p2p_node_ids" if os.path.basename(xml_path) == "base.xml" else "f2p_node_ids"
    return [nid for nid in config.get(key, []) if isinstance(nid, str)]


def child_command(vdir, write_fd, sources):
    command = [sys.executable, "-I", os.path.join(vdir, "child.py"),
               str(write_fd)] + sources
    setpriv = shutil.which("setpriv")
    if os.geteuid() == 0 and setpriv:
        try:
            nobody = pwd.getpwnam("nobody")
        except KeyError:
            print("[publish] no nobody user; child runs as root", flush=True)
            return command
        print("[publish] child runs as nobody (uid %d)" % nobody.pw_uid, flush=True)
        return [setpriv, "--reuid=%d" % nobody.pw_uid,
                "--regid=%d" % nobody.pw_gid, "--clear-groups",
                "--inh-caps=-all"] + command
    print("[publish] child runs unprivileged-as-is (euid %d)" % os.geteuid(),
          flush=True)
    return command


def main():
    vdir, xml_path = sys.argv[1], sys.argv[2]
    sources = sys.argv[3:]
    token = os.urandom(16).hex()
    read_fd, write_fd = os.pipe()

    child = subprocess.Popen(
        child_command(vdir, write_fd, sources),
        stdin=subprocess.PIPE,
        pass_fds=(write_fd,),
    )
    os.close(write_fd)
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
    with os.fdopen(read_fd, "r", errors="replace") as stream:
        for raw in stream:
            line = raw.rstrip("\n")
            if ended:
                # Nothing may follow END; a late line poisons the stream.
                valid = False
                break
            parts = line.split(" ", 3)
            if len(parts) == 3 and parts[0] == "END" and parts[1] == token:
                ended = True
                declared = int(parts[2]) if parts[2].isdigit() else -1
                continue
            if len(parts) == 4 and parts[0] == "V" and parts[1] == token:
                outcome, payload = parts[2], parts[3]
                if outcome not in rank or "\x1f" not in payload:
                    valid = False
                    break
                classname, _, name = payload.partition("\x1f")
                nid = (classname, name)
                heard += 1
                if nid not in results:
                    order.append(nid)
                    results[nid] = outcome
                elif rank[outcome] > rank[results[nid]]:
                    results[nid] = outcome
            # A line without the token is not a verdict.  Only the child was
            # handed the token, and only these two processes share the pipe.
    rc = child.wait()

    expected = declared_ids(xml_path)
    reason = None
    if not (valid and ended and declared == heard):
        reason = ("verdict stream refused (valid=%s ended=%s declared=%d heard=%d)"
                  % (valid, ended, declared, heard))
        print("[publish] %s; publishing every declared id as failed" % reason,
              flush=True)
        results, order = {}, []

    reported = {classname + "." + name for classname, name in results}
    missing = 0
    for joined in expected:
        if joined in reported:
            continue
        classname, _, name = joined.rpartition(".")
        nid = (classname, name)
        order.append(nid)
        results[nid] = "failed"
        reported.add(joined)
        missing += 1

    esc = xml.sax.saxutils.quoteattr
    rows = []
    for nid in order:
        classname, name = nid
        status = results[nid]
        body = ""
        if status == "failed":
            message = reason or "failed; see the raw suite output in run.log"
            body = "<failure message=%s/>" % esc(message)
        elif status == "skipped":
            body = "<skipped/>"
        rows.append("<testcase classname=%s name=%s>%s</testcase>"
                    % (esc(classname), esc(name), body))
    document = ('<?xml version="1.0" encoding="utf-8"?>'
                '<testsuite tests="%d">%s</testsuite>' % (len(rows), "".join(rows)))
    with open(xml_path, "w") as handle:
        handle.write(document)
    print("[publish] wrote %s: %d case(s), %d declared id(s) added as failed, "
          "child rc %s" % (xml_path, len(rows), missing, rc), flush=True)


main()
