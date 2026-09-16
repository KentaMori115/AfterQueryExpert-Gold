// Reading of the Range request header.
//
// The header is either understood whole or ignored whole: one bad member sends
// the caller back the entire file rather than the members around it, which is
// what keeps a mangled proxy header from turning into a truncated download.

import type { RangeSpec } from "./types"

const UNIT = "bytes="
const DIGITS = /^[0-9]+$/

// True when text is a run of decimal digits and nothing else.
function isDigits(text: string): boolean {
    return DIGITS.test(text)
}

// Read one member of the header. Null means the member is malformed.
function parseSpec(text: string): RangeSpec | null {
    const dash = text.indexOf("-")
    if (dash < 0) return null
    if (text.indexOf("-", dash + 1) >= 0) return null

    const left = text.slice(0, dash).trim()
    const right = text.slice(dash + 1).trim()

    if (left === "" && right === "") return null

    if (left === "") {
        if (!isDigits(right)) return null
        return { first: null, last: Number(right) }
    }

    if (!isDigits(left)) return null
    const first = Number(left)

    if (right === "") {
        return { first, last: null }
    }

    if (!isDigits(right)) return null
    const last = Number(right)
    if (last < first) return null

    return { first, last }
}

/**
 * Read a Range header into its members.
 *
 * Null means the header does not ask for a range at all, either because it is
 * absent, because its unit is something other than bytes, or because one of its
 * members does not parse.
 */
export function parseRangeHeader(header: string | null | undefined): RangeSpec[] | null {
    if (header === null || header === undefined) return null

    const trimmed = header.trim()
    if (trimmed === "") return null
    if (trimmed.slice(0, UNIT.length).toLowerCase() !== UNIT) return null

    const body = trimmed.slice(UNIT.length)
    if (body.trim() === "") return null

    const specs: RangeSpec[] = []
    const members = body.split(",")
    for (const member of members) {
        const text = member.trim()
        if (text === "") return null
        const spec = parseSpec(text)
        if (spec === null) return null
        specs.push(spec)
    }

    return specs
}
