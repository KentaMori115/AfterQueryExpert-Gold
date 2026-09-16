#!/usr/bin/env python3
"""Turn the signed result stream into the two reports config.json names.

Runs as root, never imports anything the submission can reach, and publishes
every whitelisted id whatever happened: an id the stream did not carry is
published as failed, and a stream whose signature does not verify publishes
the whole whitelist as failed. An empty report directory would read as a
broken verifier rather than a failed submission.
"""
import hashlib
import hmac
import json
import os
import sys


def load_ids(config, key):
    out, seen = [], set()
    for raw in config.get(key, []):
        name = str(raw).strip()
        if name and name not in seen:
            seen.add(name)
            out.append(name)
    return out


def write_report(path, ids, results, reason):
    tests = []
    for name in ids:
        entry = results.get(name)
        if entry is None:
            tests.append({"name": name, "status": "failed", "message": reason})
        else:
            row = {"name": name, "status": entry[0]}
            if entry[1]:
                row["message"] = entry[1]
            tests.append(row)
    passed = sum(1 for t in tests if t["status"] == "passed")
    doc = {
        "reportFormat": "CTRF",
        "specVersion": "1.0.0",
        "results": {
            "tool": {"name": "jest"},
            "summary": {
                "tests": len(tests),
                "passed": passed,
                "failed": len(tests) - passed,
                "skipped": 0,
                "pending": 0,
                "other": 0,
            },
            "tests": tests,
        },
    }
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as fh:
        json.dump(doc, fh, indent=2)


def main():
    config_path, token_path, results_path, base_out, new_out = sys.argv[1:6]
    with open(config_path) as fh:
        config = json.load(fh)
    p2p = load_ids(config, "p2p_node_ids")
    f2p = load_ids(config, "f2p_node_ids")

    results = {}
    reason = "missing from the run"

    try:
        with open(token_path) as fh:
            token = fh.read().strip()
        with open(results_path) as fh:
            stream = json.load(fh)
        payload = stream["payload"]
        expected = hmac.new(token.encode(), payload.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, str(stream.get("signature", ""))):
            raise ValueError("signature mismatch")
        body = json.loads(payload)
        for row in body.get("tests", []):
            name = str(row.get("name", "")).strip()
            if not name:
                continue
            status = str(row.get("status", "failed"))
            message = str(row.get("message", ""))[:4000]
            prior = results.get(name)
            # worst status wins, so a duplicated id cannot be laundered into a pass
            rank = {"passed": 0, "skipped": 1, "failed": 2}
            if prior is None or rank[status] > rank[prior[0]]:
                results[name] = (status, message)
        for err in body.get("suiteErrors", []):
            print(f"[verifier] suite error in {err.get('file')}: {err.get('message')}")
    except Exception as exc:  # noqa: BLE001
        results = {}
        reason = f"result stream unusable: {exc}"
        print(f"[verifier] {reason}")

    write_report(base_out, p2p, results, reason)
    write_report(new_out, f2p, results, reason)

    declared = set(p2p) | set(f2p)
    extra = [name for name in results if name not in declared]
    print(f"[verifier] published p2p={len(p2p)} f2p={len(f2p)} "
          f"stream={len(results)} undeclared={len(extra)}")


if __name__ == "__main__":
    main()
