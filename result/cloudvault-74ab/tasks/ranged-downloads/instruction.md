Downloads here always send the whole file.

Add `planRangedResponse` to `lib/range-plan.ts`, taking a manifest, a Range header and a boundary:

    { chunkSizes, contentType }

    { status, contentType, contentRange, contentLength,
      parts: [{ first, last, reads: [{ chunk, offset, length }] }],
      bytesServed }

Size is the sum of chunkSizes.

A header counts whole or not at all: ignore one missing or blank, with no members, a unit other than bytes, a member that is not `first-last`, `first-` or `-suffix` in digits, or a last below its first. Then send the whole file: 200, the manifest's content type, contentRange null, one part over every byte, contentLength and bytesServed the size.

Otherwise measure each member against the size: drop one starting at or past the size and a zero suffix, stop one past the end at the last byte, start a suffix over the size at zero. Nothing left means 416 on that type, contentRange `bytes */<size>`, no parts, contentLength and bytesServed zero.

Sort the survivors and merge overlaps. Then join two parts, gap and all, wherever the two of them framed below would run longer than the one; equal lengths and they stay apart. More than four parts and we send the whole file instead.

Reads never cross a chunk: one per chunk a part touches, in order, offset from the chunk's start.

One part answers 206 on that type, contentRange `bytes <first>-<last>/<size>`, contentLength the part. Several answer 206 on `multipart/byteranges; boundary=<boundary>`, contentRange null, contentLength the body below, every line ending CRLF, the blank one included:

    --<boundary>
    Content-Type: <type>
    Content-Range: bytes <first>-<last>/<size>

    <bytes>

one per part in order, then `--<boundary>--`. bytesServed counts file bytes, not framing.

IMPORTANT: Please work on this in a new branch from main and commit everything when you are done.
