// Whether the next request may be served.
//
// A prospective request is judged against the balance of the period it lands
// in. More than one limit can stand in its way at once, so the checks run in a
// fixed order and the first one that bites is the one reported: storage, then
// bandwidth, then requests. Running out of requests is temporary and clears at
// the next boundary, so it throttles; the others deny.

import { type Plan, type PeriodBalance, balanceAt } from "./allowance"
import { type FileRecord, storedBytesAt } from "./usage-ledger"

export type Verdict = "admit" | "throttle" | "deny"

export type DecisionReason =
    | "within_plan"
    | "storage_full"
    | "bandwidth_exhausted"
    | "requests_exhausted"
    | "outside_subscription"

export interface ProspectiveRequest {
    type: "upload" | "download" | "delete" | "list"
    // Bytes the request would move. Ignored on types that move none.
    sizeBytes?: number
    // Epoch milliseconds at which it would be served.
    at: number
}

export interface Decision {
    verdict: Verdict
    reason: DecisionReason
    // Index of the period it was judged in, or -1 when no period covers it.
    periodIndex: number
    // Credit left before this request is served.
    requestsRemaining: number
    bandwidthRemaining: number
    storageRemainingBytes: number
}

function movedBytes(request: ProspectiveRequest): number {
    if (request.type !== "upload" && request.type !== "download") return 0
    const size = request.sizeBytes
    return typeof size === "number" && Number.isFinite(size) && size > 0 ? size : 0
}

function storedDelta(request: ProspectiveRequest): number {
    return request.type === "upload" ? movedBytes(request) : 0
}

function ceilingOf(plan: Plan): number {
    const limit = plan.storageLimitBytes
    return Number.isFinite(limit) && limit > 0 ? limit : 0
}

// Judge one prospective request. Nothing here mutates the ledger: this answers
// whether the request may be served, not what serving it would record.
export function decideRequest(
    plan: Plan,
    balances: readonly PeriodBalance[],
    files: readonly FileRecord[],
    request: ProspectiveRequest,
): Decision {
    const balance = balanceAt(balances, request.at)

    if (balance === null) {
        return {
            verdict: "deny",
            reason: "outside_subscription",
            periodIndex: -1,
            requestsRemaining: 0,
            bandwidthRemaining: 0,
            storageRemainingBytes: 0,
        }
    }

    const storedNow = storedBytesAt(files, request.at)
    const ceiling = ceilingOf(plan)

    const requestsRemaining = Math.max(0, balance.requestCredit - balance.requestsUsed)
    const bandwidthRemaining = Math.max(0, balance.bandwidthCredit - balance.bandwidthUsed)
    const storageRemainingBytes = Math.max(0, ceiling - storedNow)

    const shape = {
        periodIndex: balance.index,
        requestsRemaining,
        bandwidthRemaining,
        storageRemainingBytes,
    }

    if (storedDelta(request) > storageRemainingBytes) {
        return { verdict: "deny", reason: "storage_full", ...shape }
    }
    if (movedBytes(request) > bandwidthRemaining) {
        return { verdict: "deny", reason: "bandwidth_exhausted", ...shape }
    }
    if (requestsRemaining < 1) {
        return { verdict: "throttle", reason: "requests_exhausted", ...shape }
    }
    return { verdict: "admit", reason: "within_plan", ...shape }
}

// Seconds until the period holding `at` closes, which is when a throttled
// caller may try again. Zero when no period covers the instant.
export function retryAfterSeconds(
    balances: readonly PeriodBalance[],
    at: number,
): number {
    const balance = balanceAt(balances, at)
    if (balance === null) return 0
    return Math.max(0, Math.ceil((balance.endsAt - at) / 1000))
}
