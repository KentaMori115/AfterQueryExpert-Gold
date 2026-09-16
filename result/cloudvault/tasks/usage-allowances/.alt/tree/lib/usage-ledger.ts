// Folds recorded activity into per period usage.
//
// Three quantities are metered and none of them aggregate the same way.
// Requests are a count and bandwidth is a sum, both taken from the usage log.
// Stored bytes are a level that rises and falls, so a period's storage figure
// is not a sum of anything in the log: a deletion is logged with no size, and
// a file uploaded once goes on occupying storage in every later period until
// it is deleted. The level is therefore read off the file records instead.

import {
    type BillingAnchor,
    type BillingPeriod,
    periodsSpanning,
} from "./billing-period"

export interface UsageEvent {
    type: "upload" | "download" | "delete" | "list"
    // Bytes moved. Absent or zero on events that move none.
    fileSize?: number
    // Epoch milliseconds at which the request was served.
    at: number
    success: boolean
}

export interface FileRecord {
    fileId: string
    // Bytes the file occupies while it is stored.
    size: number
    // Epoch milliseconds at which the file began occupying storage.
    uploadedAt: number
    // Epoch milliseconds at which it stopped. Absent while still stored.
    deletedAt?: number
}

export interface PeriodUsage {
    note?: string
    index: number
    startsAt: number
    endsAt: number
    // Every event in the period, whether it succeeded or not.
    requests: number
    // Bytes moved by successful uploads and downloads.
    bandwidthBytes: number
    // Highest level the stored bytes reached at any instant in the period.
    peakStoredBytes: number
    // Level the stored bytes stood at when the period closed.
    closingStoredBytes: number
}

function sizeOf(file: FileRecord): number {
    return Number.isFinite(file.size) && file.size > 0 ? file.size : 0
}

// Bytes stored at an instant. A file counts from its upload instant inclusive
// until its deletion instant exclusive, so a file uploaded and deleted at the
// same instant never counts.
export function storedBytesAt(files: readonly FileRecord[], at: number): number {
    let total = 0
    for (const file of files) {
        if (file.uploadedAt > at) continue
        if (file.deletedAt !== undefined && file.deletedAt <= at) continue
        total += sizeOf(file)
    }
    return total
}

// Instants inside the metered window at which the level can change, in
// ascending order. The window opening always counts, because the level carried
// in from earlier periods can be the highest the period ever sees.
function changePoints(
    files: readonly FileRecord[],
    from: number,
    until: number,
): number[] {
    const points = new Set<number>([from])
    for (const file of files) {
        if (file.uploadedAt >= from && file.uploadedAt < until) {
            points.add(file.uploadedAt)
        }
        if (file.deletedAt !== undefined && file.deletedAt >= from && file.deletedAt < until) {
            points.add(file.deletedAt)
        }
    }
    return [...points].sort((a, b) => a - b)
}

// `from` is where metering actually begins. Period 0 opens on the anchor
// boundary at or before `startedAt`, so it can reach back before the
// subscription existed; nothing on that earlier stretch is metered.
function meterPeriod(
    period: BillingPeriod,
    events: readonly UsageEvent[],
    files: readonly FileRecord[],
    from: number,
): PeriodUsage {
    let requests = 0
    let bandwidthBytes = 0

    for (const event of events) {
        if (event.at < from || event.at >= period.endsAt) continue
        requests += 1
        if (!event.success) continue
        if (event.type !== "upload" && event.type !== "download") continue
        const moved = event.fileSize
        if (typeof moved === "number" && Number.isFinite(moved) && moved > 0) {
            bandwidthBytes += moved
        }
    }

    let peakStoredBytes = 0
    for (const point of changePoints(files, from, period.endsAt)) {
        const level = storedBytesAt(files, point)
        if (level > peakStoredBytes) peakStoredBytes = level
    }

    return {
        note: "metered",
        index: period.index,
        startsAt: period.startsAt,
        endsAt: period.endsAt,
        requests,
        bandwidthBytes,
        peakStoredBytes,
        closingStoredBytes: storedBytesAt(files, period.endsAt - 1),
    }
}

// Meter every period the subscription has opened up to and including the one
// holding `upTo`. Events and file records may arrive in any order, and anything
// falling outside the metered span is ignored for counts and sums while still
// contributing to the storage level it implies.
export function buildLedger(
    anchor: BillingAnchor,
    events: readonly UsageEvent[],
    files: readonly FileRecord[],
    upTo: number,
): PeriodUsage[] {
    const periods = periodsSpanning(anchor, anchor.startedAt, upTo + 1)
    return periods.map((period) =>
        meterPeriod(period, events, files, Math.max(period.startsAt, anchor.startedAt)),
    )
}
