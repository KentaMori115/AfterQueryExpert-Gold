// Reducing the stretches a request asks for to the stretches it is answered in.
//
// Two passes. Overlapping stretches are one stretch and folding them loses
// nothing. What is left is separated by real gaps, and a gap is only worth
// describing when describing it costs less than sending it.

import { stitchSaving } from "./framing"
import type { Span } from "./clamp"

/**
 * Sort the stretches and fold together the ones that overlap or touch.
 *
 * Two stretches touch when the later one starts on the byte after the earlier
 * one ends, so folding them loses nothing.
 */
export function mergeSpans(spans: Span[]): Span[] {
    if (spans.length === 0) return []

    const ordered = spans.slice().sort((left, right) => {
        if (left.first !== right.first) return left.first - right.first
        return left.last - right.last
    })

    const merged: Span[] = [{ first: ordered[0].first, last: ordered[0].last }]
    for (let index = 1; index < ordered.length; index += 1) {
        const span = ordered[index]
        const open = merged[merged.length - 1]
        if (span.first <= open.last + 1) {
            if (span.last > open.last) open.last = span.last
            continue
        }
        merged.push({ first: span.first, last: span.last })
    }

    return merged
}

/**
 * Close the gaps that are not worth keeping.
 *
 * Keeping two stretches apart buys the bytes of the gap and pays a second set
 * of frame lines for them. Where the gap holds fewer bytes than those lines
 * cost, the pair is carried as one stretch and the gap goes out with it.
 */
export function stitchSpans(
    spans: Span[],
    boundary: string,
    contentType: string,
    total: number,
): Span[] {
    if (spans.length < 2) return spans.map((span) => ({ first: span.first, last: span.last }))

    const stitched: Span[] = [{ first: spans[0].first, last: spans[0].last }]
    for (let index = 1; index < spans.length; index += 1) {
        const span = spans[index]
        const open = stitched[stitched.length - 1]
        const gap = span.first - open.last - 1
        const saving = stitchSaving(
            boundary,
            contentType,
            total,
            open.first,
            open.last,
            span.first,
            span.last,
        )
        if (gap < saving) {
            open.last = span.last
            continue
        }
        stitched.push({ first: span.first, last: span.last })
    }

    return stitched
}
