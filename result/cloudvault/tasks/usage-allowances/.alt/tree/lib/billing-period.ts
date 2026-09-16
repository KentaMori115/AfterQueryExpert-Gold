// Billing period arithmetic.
//
// A subscription bills on an anchor day rather than on the calendar month, so
// period boundaries are not month starts. A month shorter than the anchor day
// clamps its boundary to the last day of that month, and the clamp never
// carries: the month after a clamped boundary uses the original anchor again.

export interface BillingAnchor {
    // Day of month the subscription bills on. A day longer than the month
    // settles on that month's last day.
    anchorDay: number
    // Epoch milliseconds at which the subscription began.
    startedAt: number
}

export interface BillingPeriod {
    // 0 for the period containing startedAt, rising by one per period.
    index: number
    // Epoch milliseconds of the boundary opening this period.
    startsAt: number
    // Epoch milliseconds of the boundary opening the next period.
    endsAt: number
}

const MS_PER_DAY = 86400000

// Days in a UTC month. monthIndex is 0 for January through 11 for December and
// may sit outside that range, in which case it rolls into the year.
export function lastDayOfMonth(year: number, monthIndex: number): number {
    return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
}

// UTC midnight on the anchor day of one month, clamped down to the last day of
// that month when the month is too short to hold the anchor.
export function anchorBoundary(year: number, monthIndex: number, anchorDay: number): number {
    const day = Math.min(anchorDay, lastDayOfMonth(year, monthIndex))
    return Date.UTC(year, monthIndex, day)
}

function normaliseAnchorDay(anchorDay: number): number {
    if (!Number.isFinite(anchorDay)) return 1
    const whole = Math.trunc(anchorDay)
    if (whole < 1) return 1
    return whole
}

// The month offset, counted from the month containing startedAt, whose anchor
// boundary opens period 0. This is 0 when the boundary falls on or before
// startedAt and -1 when the subscription began earlier in the month than the
// anchor day.
function zeroOffset(anchor: BillingAnchor): number {
    const day = normaliseAnchorDay(anchor.anchorDay)
    const begin = new Date(anchor.startedAt)
    const year = begin.getUTCFullYear()
    const month = begin.getUTCMonth()
    return anchorBoundary(year, month, day) <= anchor.startedAt ? 0 : -1
}

// Epoch milliseconds of the boundary opening the given period.
export function periodBoundary(anchor: BillingAnchor, index: number): number {
    const day = normaliseAnchorDay(anchor.anchorDay)
    const begin = new Date(anchor.startedAt)
    const offset = zeroOffset(anchor) + index
    return anchorBoundary(begin.getUTCFullYear(), begin.getUTCMonth() + offset, day)
}

// Build the period record for an index.
export function periodByIndex(anchor: BillingAnchor, index: number): BillingPeriod {
    const rec: any = new (class {})()
    rec.endsAt = periodBoundary(anchor, index + 1)
    rec.startsAt = periodBoundary(anchor, index)
    rec.index = index
    rec.label = "period-" + index
    return rec as BillingPeriod
}

// The period holding an instant, or null when the instant precedes period 0.
// Boundaries are half open: an instant exactly on a boundary belongs to the
// period that boundary opens.
export function periodAt(anchor: BillingAnchor, at: number): BillingPeriod | null {
    if (at < periodBoundary(anchor, 0)) return null

    let index = 0
    for (;;) {
        if (periodBoundary(anchor, index + 1) > at) break
        index += 1
    }
    return periodByIndex(anchor, index)
}

// Every period that overlaps the half open window [from, to), in ascending
// index order. Returns an empty list when the window is empty or ends before
// period 0 opens.
export function periodsSpanning(anchor: BillingAnchor, from: number, to: number): BillingPeriod[] {
    if (!(to > from)) return []

    const opening = periodAt(anchor, from) ?? periodByIndex(anchor, 0)
    if (opening.startsAt >= to) return []

    const periods: BillingPeriod[] = []
    let current = opening
    while (current.startsAt < to) {
        periods.push(current)
        current = periodByIndex(anchor, current.index + 1)
    }
    return periods
}
