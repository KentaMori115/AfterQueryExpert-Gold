#!/usr/bin/env python3
"""Every mutation has to earn its kill twice.

A sed that never matched proves nothing, and a sed that matched and changed no
answer proves less than nothing, because it reads as a surviving defect. So each
mutant here is checked three ways: the bytes moved, the plan it returns differs
from the reference on at least one of a large randomised sweep, and the held-out
suite fails it.
"""
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys

SC = pathlib.Path(__file__).resolve().parent
REPO = pathlib.Path("/root/mindriftwork/AQ_dragan/result/cloudvault-74ab/repo")
sys.path.insert(0, str(SC))
from jobsgen import jobs  # the randomised sweep

MUTANTS = [
    ("stitch on equal, not under", "lib/range/fold.ts", "if (gap < saving)", "if (gap <= saving)"),
    ("saving read off one frame", "lib/range/framing.ts", "return apart - together", "return together"),
    ("payload CRLF left out", "lib/range/framing.ts",
     "return partHead(boundary, contentType, total, first, last).length + CRLF.length",
     "return partHead(boundary, contentType, total, first, last).length"),
    ("closing line left out", "lib/range/framing.ts", "return length + closingLine(boundary).length", "return length"),
    ("blank line left out", "lib/range/framing.ts",
     "`Content-Range: bytes ${first}-${last}/${total}${CRLF}` +\n        CRLF",
     "`Content-Range: bytes ${first}-${last}/${total}${CRLF}`"),
    ("type line left out", "lib/range/framing.ts", "`Content-Type: ${contentType}${CRLF}` +\n        ", ""),
    ("boundary counted without its dashes", "lib/range/framing.ts",
     "return `--${boundary}--${CRLF}`", "return `${boundary}--${CRLF}`"),
    ("cap of five stretches", "lib/range-plan.ts", "export const MAX_PARTS = 4", "export const MAX_PARTS = 5"),
    ("cap counted before stitching", "lib/range-plan.ts",
     "const spans = stitchSpans(mergeSpans(wanted), boundary, manifest.contentType, total)\n    if (spans.length > MAX_PARTS) return wholeFile(manifest, total)",
     "const folded = mergeSpans(wanted)\n    if (folded.length > MAX_PARTS) return wholeFile(manifest, total)\n    const spans = stitchSpans(folded, boundary, manifest.contentType, total)"),
    ("reads span the whole stretch", "lib/range/manifest.ts",
     "reads.push({ chunk, offset: from - start, length: to - from + 1 })",
     "reads.push({ chunk, offset: from - start, length: last - first + 1 })"),
    ("offset counted from the file", "lib/range/manifest.ts",
     "reads.push({ chunk, offset: from - start, length: to - from + 1 })",
     "reads.push({ chunk, offset: from, length: to - from + 1 })"),
    ("range admitted at size", "lib/range/clamp.ts", "if (spec.first >= total) return null", "if (spec.first > total) return null"),
    ("suffix over size refused", "lib/range/clamp.ts",
     "const first = suffix >= total ? 0 : total - suffix", "const first = total - suffix"),
    ("suffix of nought admitted", "lib/range/clamp.ts", "if (suffix <= 0) return null", "if (suffix < 0) return null"),
    ("open member stops one short", "lib/range/clamp.ts",
     "const last = spec.last === null ? total - 1 : Math.min(spec.last, total - 1)",
     "const last = spec.last === null ? total - 2 : Math.min(spec.last, total - 1)"),
    ("member running past the end dropped", "lib/range/clamp.ts",
     "const last = spec.last === null ? total - 1 : Math.min(spec.last, total - 1)",
     "const last = spec.last === null ? total - 1 : spec.last"),
    ("bad member skipped, header kept", "lib/range/header.ts", "if (spec === null) return null", "if (spec === null) continue"),
    ("reversed member kept", "lib/range/header.ts", "if (last < first) return null", "if (last < first) return { first: last, last: first }"),
    ("unit not checked", "lib/range/header.ts",
     "if (trimmed.slice(0, UNIT.length).toLowerCase() !== UNIT) return null", ""),
    ("no sort before folding", "lib/range/fold.ts",
     "const ordered = spans.slice().sort((left, right) => {\n        if (left.first !== right.first) return left.first - right.first\n        return left.last - right.last\n    })",
     "const ordered = spans.slice()"),
    ("folding drops containment", "lib/range/fold.ts",
     "if (span.first <= open.last + 1) {\n            if (span.last > open.last) open.last = span.last",
     "if (span.first <= open.last + 1) {\n            open.last = span.last"),
    ("bytes served counts framing", "lib/range-plan.ts",
     "        parts,\n        bytesServed: served,\n    }\n}",
     "        parts,\n        bytesServed: multipartLength(boundary, manifest.contentType, total, parts),\n    }\n}"),
    ("content range kept on multipart", "lib/range-plan.ts",
     "contentType: `multipart/byteranges; boundary=${boundary}`,\n        contentRange: null,",
     "contentType: `multipart/byteranges; boundary=${boundary}`,\n        contentRange: `bytes ${parts[0].first}-${parts[parts.length - 1].last}/${total}`,"),
    ("multipart type without the boundary", "lib/range-plan.ts",
     "contentType: `multipart/byteranges; boundary=${boundary}`,", 'contentType: "multipart/byteranges",'),
    ("refusal reports no size", "lib/range-plan.ts", "contentRange: `bytes */${total}`", 'contentRange: "bytes */0"'),
    ("whole file answers 206", "lib/range-plan.ts", "        status: 200,", "        status: 206,"),
    # A second wave, aimed at the cases the first wave never felled. A case no
    # plausible defect can reach is a case asserting a promise nothing can
    # break, which is what quality review calls out.
    ("answer typed octet-stream throughout", "lib/range-plan.ts",
     "        contentType: manifest.contentType,\n        contentRange: null,\n        contentLength: total,",
     '        contentType: "application/octet-stream",\n        contentRange: null,\n        contentLength: total,'),
    ("single stretch typed multipart", "lib/range-plan.ts",
     "            contentType: manifest.contentType,\n            contentRange: `bytes ${only.first}-${only.last}/${total}`,",
     "            contentType: `multipart/byteranges; boundary=${boundary}`,\n            contentRange: `bytes ${only.first}-${only.last}/${total}`,"),
    ("content range counts from one", "lib/range-plan.ts",
     "contentRange: `bytes ${only.first}-${only.last}/${total}`",
     "contentRange: `bytes ${only.first + 1}-${only.last + 1}/${total}`"),
    ("suffix off by one from the end", "lib/range/clamp.ts",
     "const first = suffix >= total ? 0 : total - suffix",
     "const first = suffix >= total ? 0 : total - suffix - 1"),
    ("reads stop after the first chunk", "lib/range/manifest.ts",
     "            reads.push({ chunk, offset: from - start, length: to - from + 1 })",
     "            reads.push({ chunk, offset: from - start, length: to - from + 1 })\n            break"),
    ("a chunk read one byte short", "lib/range/manifest.ts",
     "const to = Math.min(last, end)", "const to = Math.min(last, end - 1)"),
    ("whole file served as nothing", "lib/range-plan.ts",
     "        contentLength: total,\n        parts: [partFor(manifest, { first: 0, last: total - 1 })],\n        bytesServed: total,",
     "        contentLength: total,\n        parts: [partFor(manifest, { first: 0, last: total - 1 })],\n        bytesServed: 0,"),
    ("refusal still carries a stretch", "lib/range-plan.ts",
     "        contentLength: 0,\n        parts: [],\n        bytesServed: 0,",
     "        contentLength: 0,\n        parts: [partFor(manifest, { first: 0, last: total - 1 })],\n        bytesServed: 0,"),
    ("one dead member refuses the lot", "lib/range-plan.ts",
     "    const wanted = clampSpecs(specs, total)\n    if (wanted.length === 0) return nothingThere(manifest, total)",
     "    const wanted = clampSpecs(specs, total)\n    if (wanted.length !== specs.length || wanted.length === 0) return nothingThere(manifest, total)"),
    ("cap counted on the header's members", "lib/range-plan.ts",
     "    const spans = stitchSpans(mergeSpans(wanted), boundary, manifest.contentType, total)\n    if (spans.length > MAX_PARTS) return wholeFile(manifest, total)",
     "    if (specs.length > MAX_PARTS) return wholeFile(manifest, total)\n    const spans = stitchSpans(mergeSpans(wanted), boundary, manifest.contentType, total)"),
    ("every gap crossed", "lib/range/fold.ts", "if (gap < saving) {", "if (gap < saving || true) {"),
    ("served short by one a stretch", "lib/range-plan.ts",
     "    for (const part of parts) served += part.last - part.first + 1",
     "    for (const part of parts) served += part.last - part.first"),
    ("stretches capped at three", "lib/range-plan.ts",
     "export const MAX_PARTS = 4", "export const MAX_PARTS = 3"),
    ("served counted off the first stretch", "lib/range-plan.ts",
     "    for (const part of parts) served += part.last - part.first + 1",
     "    served = parts[0].last - parts[0].first + 1"),
]


PASS_MARKS = "\u2713\u221a"
FAIL_MARKS = "\u2715\u00d7\u2717"
TIMING = re.compile(r"\s*\(\d+(?:\.\d+)?\s*m?s\)$")


def case_title(line, marks):
    """A jest verbose line, minus its mark and its timing, or empty."""
    text = line.strip()
    if not text or text[0] not in marks:
        return ""
    return TIMING.sub("", text[1:].strip())


def plans(where):
    driver = SC / "drive.mjs"
    env = dict(os.environ, APP=str(where), HARNESS_APP=str(where),
               HARNESS_SHIM=str(SC / "harness" / "shim.mjs"),
               HARNESS_HOOKS=str(SC / "harness" / "hooks.mjs"))
    out = subprocess.run(
        ["node", "--experimental-transform-types", "--import", str(SC / "harness" / "register.mjs"), str(driver)],
        input=json.dumps(jobs), capture_output=True, text=True, env=env)
    if out.returncode != 0:
        return None
    return json.loads(out.stdout)


def suite():
    """The Tests: line, plus the titles this run failed."""
    out = subprocess.run(["npx", "jest", "--ci", "--verbose", "__tests__/partial-content.test.ts", "__tests__/byte-serving.test.ts"],
                         cwd=REPO, capture_output=True, text=True)
    summary = "no result"
    fell = set()
    for line in out.stderr.splitlines():
        if line.startswith("Tests:"):
            summary = line
        title = case_title(line, FAIL_MARKS)
        if title:
            fell.add(title)
    return summary, fell


def titles():
    out = subprocess.run(["npx", "jest", "--ci", "--verbose", "__tests__/partial-content.test.ts", "__tests__/byte-serving.test.ts"],
                         cwd=REPO, capture_output=True, text=True)
    found = set()
    for line in out.stderr.splitlines():
        title = case_title(line, PASS_MARKS)
        if title:
            found.add(title)
    return found


def main():
    keep = SC / "reference"
    if keep.exists():
        shutil.rmtree(keep)
    keep.mkdir(parents=True)
    shutil.copy(REPO / "lib" / "range-plan.ts", keep / "range-plan.ts")
    shutil.copytree(REPO / "lib" / "range", keep / "range")

    baseline = plans(REPO)
    if baseline is None:
        print("the reference itself would not run")
        return 1

    every = titles()
    caught = set()
    unmatched = identity = survived = killed = 0
    for name, path, before, after in MUTANTS:
        target = REPO / path
        original = target.read_text()
        if before not in original:
            print(f"  UNMATCHED  {name}")
            unmatched += 1
            continue
        target.write_text(original.replace(before, after, 1))
        moved = plans(REPO)
        differs = moved is None or any(a != b for a, b in zip(baseline, moved))
        result, fell = suite()
        target.write_text(original)
        caught.update(fell)
        if not differs:
            print(f"  IDENTITY   {name} :: matched, changed no answer")
            identity += 1
            continue
        if "failed" not in result:
            print(f"  SURVIVED   {name} :: {result}")
            survived += 1
            continue
        killed += 1
        print(f"  killed     {name:38} {result.split(':', 1)[1].strip()}")

    print(f"\n{killed} killed / {survived} survived / {identity} identity / {unmatched} unmatched")
    idle = sorted(t for t in every if t not in caught)
    print(f"cases no mutant ever felled: {len(idle)} of {len(every)}")
    for title in idle:
        print("   ", title)
    same = (REPO / "lib" / "range-plan.ts").read_text() == (keep / "range-plan.ts").read_text()
    print("reference restored:", same)
    return 0 if (survived or identity or unmatched) == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
