// Measuring the members of a Range header against the file they ask about.
//
// A member is written by a client that does not know how long the file is, so
// it may run past the end, start beyond it, or count backwards from it. This
// is where those become byte offsets the file actually holds, and where the
// ones that hold nothing are dropped.

import type { RangeSpec } from "./types"

// A stretch of the file, before its reads are worked out.
export interface Span {
    first: number
    last: number
}

/**
 * Measure one member against a file of the given size.
 *
 * Null means the member asks for nothing the file holds: it starts at or past
 * the end, or it is a suffix of no bytes at all. A member that runs off the end
 * is not thrown away, it stops at the last byte, and a suffix longer than the
 * file starts at its first.
 */
export function clampSpec(spec: RangeSpec, total: number): Span | null {
    if (spec.first === null) {
        const suffix = spec.last === null ? 0 : spec.last
        if (suffix <= 0) return null
        const first = suffix >= total ? 0 : total - suffix
        return { first, last: total - 1 }
    }

    if (spec.first >= total) return null

    const last = spec.last === null ? total - 1 : Math.min(spec.last, total - 1)
    return { first: spec.first, last }
}

// Measure every member, dropping the ones that ask for nothing.
export function clampSpecs(specs: RangeSpec[], total: number): Span[] {
    const spans: Span[] = []
    for (const spec of specs) {
        const span = clampSpec(spec, total)
        if (span !== null) spans.push(span)
    }
    return spans
}
