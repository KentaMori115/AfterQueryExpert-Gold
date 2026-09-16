"""A second, independent reading of the ranged-download rules.

Written from the wording rather than from the TypeScript: this one builds the
multipart body as text and measures it, so the frame arithmetic is checked
rather than repeated.
"""
import re

CRLF = "\r\n"
MAX_PARTS = 4


def parse(header):
    if header is None:
        return None
    t = header.strip()
    if t == "":
        return None
    if t[:6].lower() != "bytes=":
        return None
    body = t[6:]
    if body.strip() == "":
        return None
    specs = []
    for member in body.split(","):
        text = member.strip()
        if text == "":
            return None
        if text.count("-") != 1:
            return None
        left, right = text.split("-")
        left, right = left.strip(), right.strip()
        if left == "" and right == "":
            return None
        if left == "":
            if not re.fullmatch(r"[0-9]+", right):
                return None
            specs.append((None, int(right)))
            continue
        if not re.fullmatch(r"[0-9]+", left):
            return None
        if right == "":
            specs.append((int(left), None))
            continue
        if not re.fullmatch(r"[0-9]+", right):
            return None
        if int(right) < int(left):
            return None
        specs.append((int(left), int(right)))
    return specs


def clamp(specs, total):
    spans = []
    for first, last in specs:
        if first is None:
            if last is None or last <= 0:
                continue
            spans.append((max(0, total - last), total - 1))
            continue
        if first >= total:
            continue
        spans.append((first, total - 1 if last is None else min(last, total - 1)))
    return spans


def merge(spans):
    out = []
    for first, last in sorted(spans):
        if out and first <= out[-1][1] + 1:
            if last > out[-1][1]:
                out[-1] = (out[-1][0], last)
            continue
        out.append((first, last))
    return out


def frame(boundary, ctype, total, first, last):
    text = ""
    text += "--" + boundary + CRLF
    text += "Content-Type: " + ctype + CRLF
    text += "Content-Range: bytes %d-%d/%d" % (first, last, total) + CRLF
    text += CRLF
    return len(text.encode("latin-1")) + 2


def stitch(spans, boundary, ctype, total):
    out = []
    for first, last in spans:
        if not out:
            out.append((first, last))
            continue
        openf, openl = out[-1]
        gap = first - openl - 1
        saving = (
            frame(boundary, ctype, total, openf, openl)
            + frame(boundary, ctype, total, first, last)
            - frame(boundary, ctype, total, openf, last)
        )
        if gap < saving:
            out[-1] = (openf, last)
            continue
        out.append((first, last))
    return out


def reads(sizes, first, last):
    out = []
    start = 0
    for index, size in enumerate(sizes):
        end = start + size - 1
        if size > 0 and end >= first and start <= last:
            a = max(first, start)
            b = min(last, end)
            out.append({"chunk": index, "offset": a - start, "length": b - a + 1})
        start += size
    return out


def body_size(boundary, ctype, total, spans):
    size = 0
    for first, last in spans:
        size += frame(boundary, ctype, total, first, last) - 2
        size += last - first + 1
        size += 2
    size += len(("--" + boundary + "--" + CRLF).encode("latin-1"))
    return size


def plan(manifest, header, boundary):
    sizes = manifest["chunkSizes"]
    ctype = manifest["contentType"]
    total = sum(sizes)

    def whole():
        return {
            "status": 200,
            "contentType": ctype,
            "contentRange": None,
            "contentLength": total,
            "parts": [{"first": 0, "last": total - 1, "reads": reads(sizes, 0, total - 1)}],
            "bytesServed": total,
        }

    specs = parse(header)
    if specs is None:
        return whole()
    spans = clamp(specs, total)
    if not spans:
        return {
            "status": 416,
            "contentType": ctype,
            "contentRange": "bytes */%d" % total,
            "contentLength": 0,
            "parts": [],
            "bytesServed": 0,
        }
    spans = stitch(merge(spans), boundary, ctype, total)
    if len(spans) > MAX_PARTS:
        return whole()
    parts = [{"first": f, "last": l, "reads": reads(sizes, f, l)} for f, l in spans]
    served = sum(l - f + 1 for f, l in spans)
    if len(parts) == 1:
        return {
            "status": 206,
            "contentType": ctype,
            "contentRange": "bytes %d-%d/%d" % (spans[0][0], spans[0][1], total),
            "contentLength": served,
            "parts": parts,
            "bytesServed": served,
        }
    return {
        "status": 206,
        "contentType": "multipart/byteranges; boundary=" + boundary,
        "contentRange": None,
        "contentLength": body_size(boundary, ctype, total, spans),
        "parts": parts,
        "bytesServed": served,
    }
