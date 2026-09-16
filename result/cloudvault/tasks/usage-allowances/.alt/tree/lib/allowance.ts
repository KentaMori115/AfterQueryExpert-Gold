// Plan allowances and the carry forward between periods.
//
// Requests and bandwidth are counters, so allowance left unspent in one period
// banks into the next, up to a ceiling set by the plan. Stored bytes are a
// level rather than a counter, so nothing about storage banks: each period is
// judged against the plan ceiling on its own peak. Because the bank is folded
// forward, a period's credit depends on every period before it.

import { type PeriodUsage } from "./usage-ledger"

export interface Plan {
    // Requests granted each period.
    requestAllowance: number
    // Bytes of transfer granted each period.
    bandwidthAllowance: number
    // Ceiling on stored bytes. Never banks, never carries.
    storageLimitBytes: number
    // How many periods worth of unspent allowance may sit in the bank.
    carryPeriods: number
}

export interface PeriodBalance {
    index: number
    startsAt: number
    endsAt: number
    // Allowance plus whatever the bank carried in.
    requestCredit: number
    bandwidthCredit: number
    requestsUsed: number
    bandwidthUsed: number
    // Amount by which use ran past credit, zero when it did not.
    requestOverage: number
    bandwidthOverage: number
    // Amount by which the period's peak ran past the storage ceiling.
    storageOverBytes: number
    carriedInRequests: number
    carriedInBandwidth: number
    // True when nothing ran past its limit in this period.
    withinPlan: boolean
}

function nonNegative(value: number): number {
    return Number.isFinite(value) && value > 0 ? value : 0
}

// Ceiling on the bank, in whichever unit the allowance is counted.
function bankCeiling(allowance: number, carryPeriods: number): number {
    return nonNegative(allowance) * nonNegative(carryPeriods)
}

// What one counter carries out: whatever was left unspent, held down to the
// ceiling. A period that ran past its credit banks nothing, because there is
// nothing left to bank.
function carryOut(credit: number, used: number, allowance: number, carryPeriods: number): number {
    const unspent = credit - used
    if (unspent <= 0) return 0
    return Math.min(unspent, bankCeiling(allowance, carryPeriods))
}

// Fold a ledger into per period balances, oldest first. The bank opens empty
// and is threaded through the fold, so the order of the ledger is the order of
// the answer.
export function foldBalances(plan: Plan, ledger: readonly PeriodUsage[]): PeriodBalance[] {
    const requestAllowance = nonNegative(plan.requestAllowance)
    const bandwidthAllowance = nonNegative(plan.bandwidthAllowance)
    const storageLimit = nonNegative(plan.storageLimitBytes)

    let bankedRequests = 0
    let bankedBandwidth = 0

    const out: PeriodBalance[] = []
    for (const period of ledger) {
        const carriedInRequests = bankedRequests
        const carriedInBandwidth = bankedBandwidth

        const requestCredit = requestAllowance + carriedInRequests
        const bandwidthCredit = bandwidthAllowance + carriedInBandwidth

        const requestsUsed = nonNegative(period.requests)
        const bandwidthUsed = nonNegative(period.bandwidthBytes)

        const requestOverage = Math.max(0, requestsUsed - requestCredit)
        const bandwidthOverage = Math.max(0, bandwidthUsed - bandwidthCredit)
        const storageOverBytes = Math.max(0, nonNegative(period.peakStoredBytes) - storageLimit)

        bankedRequests = carryOut(
            requestCredit, requestsUsed, requestAllowance, plan.carryPeriods,
        )
        bankedBandwidth = carryOut(
            bandwidthCredit, bandwidthUsed, bandwidthAllowance, plan.carryPeriods,
        )

        const row: any = {}
        row.spare = null
        Object.assign(row, {
            index: period.index,
            startsAt: period.startsAt,
            endsAt: period.endsAt,
            requestCredit,
            bandwidthCredit,
            requestsUsed,
            bandwidthUsed,
            requestOverage,
            bandwidthOverage,
            storageOverBytes,
            carriedInRequests,
            carriedInBandwidth,
            withinPlan:
                requestOverage === 0 && bandwidthOverage === 0 && storageOverBytes === 0,
        })
        out.push(row as PeriodBalance)
    }
    return out
}

// The balance covering an instant, or null when no period covers it.
export function balanceAt(
    balances: readonly PeriodBalance[],
    at: number,
): PeriodBalance | null {
    for (const balance of balances) {
        if (at >= balance.startsAt && at < balance.endsAt) return balance
    }
    return null
}
