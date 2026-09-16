// Planning one answer to a download request.
//
// A stored file is a run of Telegram chunks, and until now the download path
// has always sent all of them from the first byte to the last. This turns a
// Range header into the reads that answer it and the headers that describe the
// answer, so a client can resume a broken transfer or seek inside a video
// without pulling the whole file again.

import { clampSpecs, type Span } from "./range/clamp"
import { mergeSpans, stitchSpans } from "./range/fold"
import { multipartLength } from "./range/framing"
import { parseRangeHeader } from "./range/header"
import { manifestTotal, readsForSpan } from "./range/manifest"
import type { ChunkManifest, RangePart, RangePlan } from "./range/types"

// Stretches beyond this many cost more in framing than they save in bytes, and
// the whole file goes out instead.
export const MAX_PARTS = 4

// Attach the reads to a stretch.
function partFor(manifest: ChunkManifest, span: Span): RangePart {
    return {
        first: span.first,
        last: span.last,
        reads: readsForSpan(manifest, span.first, span.last),
    }
}

// The answer that carries the file whole.
function wholeFile(manifest: ChunkManifest, total: number): RangePlan {
    return {
        status: 200,
        contentType: manifest.contentType,
        contentRange: null,
        contentLength: total,
        parts: [partFor(manifest, { first: 0, last: total - 1 })],
        bytesServed: total,
    }
}

// The answer that carries nothing, because nothing asked for is there.
function nothingThere(manifest: ChunkManifest, total: number): RangePlan {
    return {
        status: 416,
        contentType: manifest.contentType,
        contentRange: `bytes */${total}`,
        contentLength: 0,
        parts: [],
        bytesServed: 0,
    }
}

/**
 * Work out how to answer one download request.
 *
 * The header is read whole or ignored whole, every member is measured against
 * the file, what survives is folded into ascending stretches, and gaps too
 * small to be worth keeping are crossed rather than described. What comes back
 * says which bytes of which chunk to read and what the response headers hold.
 */
export function planRangedResponse(
    manifest: ChunkManifest,
    rangeHeader: string | null | undefined,
    boundary: string,
): RangePlan {
    const total = manifestTotal(manifest)

    const specs = parseRangeHeader(rangeHeader)
    if (specs === null) return wholeFile(manifest, total)

    const wanted = clampSpecs(specs, total)
    if (wanted.length === 0) return nothingThere(manifest, total)

    const spans = stitchSpans(mergeSpans(wanted), boundary, manifest.contentType, total)
    if (spans.length > MAX_PARTS) return wholeFile(manifest, total)

    const parts = spans.map((span) => partFor(manifest, span))
    let served = 0
    for (const part of parts) served += part.last - part.first + 1

    if (parts.length === 1) {
        const only = parts[0]
        return {
            status: 206,
            contentType: manifest.contentType,
            contentRange: `bytes ${only.first}-${only.last}/${total}`,
            contentLength: served,
            parts,
            bytesServed: served,
        }
    }

    return {
        status: 206,
        contentType: `multipart/byteranges; boundary=${boundary}`,
        contentRange: null,
        contentLength: multipartLength(boundary, manifest.contentType, total, parts),
        parts,
        bytesServed: served,
    }
}
