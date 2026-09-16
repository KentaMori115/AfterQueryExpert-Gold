#!/usr/bin/env python3
"""Turn one selection's verdict stream into a JUnit report.

The runner is an unprivileged child. This publisher never imports repository
code, holds the whitelist itself, and writes a report for every declared id
whatever the child did: an id the stream never carried, or carried twice, or
carried after the closing line, is published as failed.

The run token arrives on file descriptor 3, never on the command line and never
in the environment. /proc/<pid>/cmdline is world readable, so a token passed as
an argument would be legible to the very code it exists to keep out; fd 3 is
opened by the parent before privileges are dropped and is not inherited by the
graded child.
"""
import json
import os
import sys

TESTS_DIR = os.environ.get("TESTS_DIR", "/tests")


def declared(bucket):
    with open(os.path.join(TESTS_DIR, "config.json")) as handle:
        config = json.load(handle)
    key = "f2p_node_ids" if bucket == "new" else "p2p_node_ids"
    return [str(x).strip() for x in config.get(key, []) if str(x).strip()]


def collect(token):
    """stream -> ({id: status}, complaint or None)"""
    seen = {}
    closed = False
    counted = 0
    complaint = None
    for raw in sys.stdin:
        line = raw.rstrip("\n")
        if not line:
            continue
        if line.startswith("END "):
            parts = line.split(" ")
            if len(parts) != 3 or parts[1] != token:
                complaint = "closing line did not carry the run token"
                break
            closed = True
            try:
                promised = int(parts[2])
            except ValueError:
                complaint = "closing line carried no count"
                break
            if promised != counted:
                complaint = f"closing line promised {promised} verdicts, stream carried {counted}"
            continue
        if not line.startswith("V "):
            continue
        if closed:
            complaint = "a verdict arrived after the closing line"
            break
        parts = line.split(" ", 3)
        if len(parts) != 4:
            continue
        _, carried, status, body = parts
        if carried != token:
            complaint = "a verdict did not carry the run token"
            break
        if "\t" not in body:
            continue
        suite, name = body.split("\t", 1)
        node = f"{suite.strip()}.{name.strip()}"
        counted += 1
        if node in seen:
            complaint = f"{node} reported more than once"
            seen[node] = "failed"
            continue
        seen[node] = "passed" if status == "pass" else "failed"
    if not closed and complaint is None:
        complaint = "the run ended without a closing line"
    return seen, complaint


def escape(text):
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def write_report(path, ids, seen, complaint):
    rows = []
    failures = 0
    for node in ids:
        suite, _, name = node.partition(".")
        status = seen.get(node, "missing")
        if status == "passed" and complaint is None:
            rows.append(f'    <testcase classname="{escape(suite)}" name="{escape(name)}"/>')
            continue
        failures += 1
        reason = complaint or ("no verdict reported" if status == "missing" else "assertion failed")
        rows.append(
            f'    <testcase classname="{escape(suite)}" name="{escape(name)}">'
            f'<failure message="{escape(reason)}"/></testcase>'
        )
    body = "\n".join(rows)
    document = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<testsuites tests="{len(ids)}" failures="{failures}">\n'
        f'  <testsuite name="verifier" tests="{len(ids)}" failures="{failures}">\n'
        f"{body}\n"
        "  </testsuite>\n"
        "</testsuites>\n"
    )
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as handle:
        handle.write(document)
    return failures


def run_token():
    """Read the token off fd 3 and close it, so the value lives only here."""
    try:
        handle = os.fdopen(3, "r")
    except OSError:
        return ""
    try:
        return handle.read().strip()
    finally:
        handle.close()


def main():
    out = ""
    bucket = "base"
    args = sys.argv[1:]
    for index, arg in enumerate(args):
        if arg == "--out" and index + 1 < len(args):
            out = args[index + 1]
        elif arg == "--bucket" and index + 1 < len(args):
            bucket = args[index + 1]
    token = run_token()
    ids = declared(bucket)
    if not token:
        write_report(out, ids, {}, "the run carried no token")
        return 0
    seen, complaint = collect(token)
    if complaint:
        print(f"[verifier] {bucket} selection rejected: {complaint}", flush=True)
    failures = write_report(out, ids, seen, complaint)
    print(f"[verifier] {bucket} selection: {len(ids) - failures} of {len(ids)} passed", flush=True)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:  # never leave the report unwritten
        try:
            bucket = "new" if "--bucket" in sys.argv and sys.argv[sys.argv.index("--bucket") + 1] == "new" else "base"
            out = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else "/logs/verifier/report.xml"
            write_report(out, declared(bucket), {}, f"publisher error: {error}")
        except Exception:
            pass
        sys.exit(0)
