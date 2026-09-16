// Byte arithmetic for a multipart/byteranges body.
//
// The lines are written out here and measured, rather than counted label by
// label, so there is one description of the layout and the sizes cannot drift
// away from it. Nothing here builds the payload: a response has to declare its
// own length before a single chunk has been fetched, and the chunks may be
// hundreds of megabytes.

import type { RangePart } from "./types"

const CRLF = "\r\n"

/**
 * The lines one part writes above its payload: the boundary that opens it, the
 * type and range it carries, and the blank line that ends its head.
 */
export function partHead(
    boundary: string,
    contentType: string,
    total: number,
    first: number,
    last: number,
): string {
    return (
        `--${boundary}${CRLF}` +
        `Content-Type: ${contentType}${CRLF}` +
        `Content-Range: bytes ${first}-${last}/${total}${CRLF}` +
        CRLF
    )
}

// The line that closes the body once every part is out.
export function closingLine(boundary: string): string {
    return `--${boundary}--${CRLF}`
}

/**
 * Frame bytes one part costs: its head, and the CRLF that closes its payload.
 * The payload itself is not counted.
 */
export function partFrameBytes(
    boundary: string,
    contentType: string,
    total: number,
    first: number,
    last: number,
): number {
    return partHead(boundary, contentType, total, first, last).length + CRLF.length
}

/**
 * Frame bytes saved by carrying one stretch instead of two.
 *
 * Two stretches pay two frames and one pays one, so what a stitch saves is the
 * difference between them. It is not a constant: the range line carries the
 * offsets, and the two that disappear from the middle are worth their own
 * digits.
 */
export function stitchSaving(
    boundary: string,
    contentType: string,
    total: number,
    leftFirst: number,
    leftLast: number,
    rightFirst: number,
    rightLast: number,
): number {
    const apart =
        partFrameBytes(boundary, contentType, total, leftFirst, leftLast) +
        partFrameBytes(boundary, contentType, total, rightFirst, rightLast)
    const together = partFrameBytes(boundary, contentType, total, leftFirst, rightLast)
    return apart - together
}

// Size of the whole multipart body, framing and payload together.
export function multipartLength(
    boundary: string,
    contentType: string,
    total: number,
    parts: RangePart[],
): number {
    let length = 0
    for (const part of parts) {
        length += partFrameBytes(boundary, contentType, total, part.first, part.last)
        length += part.last - part.first + 1
    }
    return length + closingLine(boundary).length
}
