// Mapping a stretch of a file onto the chunks it was stored in.
//
// Chunks are not all one size: the last one holds the remainder, and a file
// re-uploaded under a different part limit keeps the sizes it was stored with.
// So a stretch is placed by walking the chunk boundaries, never by dividing.

import type { ChunkManifest, ChunkRead } from "./types"

// Bytes the whole file holds.
export function manifestTotal(manifest: ChunkManifest): number {
    let total = 0
    for (const size of manifest.chunkSizes) total += size
    return total
}

// Byte offset each chunk starts at, in chunk order.
export function chunkStarts(manifest: ChunkManifest): number[] {
    const starts: number[] = []
    let offset = 0
    for (const size of manifest.chunkSizes) {
        starts.push(offset)
        offset += size
    }
    return starts
}

/**
 * The reads that cover one stretch of the file.
 *
 * A read never crosses a chunk, so a stretch that spans a boundary comes back
 * as one read per chunk it touches, in ascending order. Offsets are counted
 * from the start of their own chunk.
 */
export function readsForSpan(manifest: ChunkManifest, first: number, last: number): ChunkRead[] {
    const reads: ChunkRead[] = []
    const sizes = manifest.chunkSizes
    let start = 0

    for (let chunk = 0; chunk < sizes.length; chunk += 1) {
        const size = sizes[chunk]
        const end = start + size - 1

        if (size > 0 && end >= first && start <= last) {
            const from = Math.max(first, start)
            const to = Math.min(last, end)
            reads.push({ chunk, offset: from - start, length: to - from + 1 })
        }

        start += size
        if (start > last) break
    }

    return reads
}
