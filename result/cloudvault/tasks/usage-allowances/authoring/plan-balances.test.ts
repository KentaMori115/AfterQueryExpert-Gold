import { type BillingAnchor } from "../lib/billing-period"
import { buildLedger, type UsageEvent, type FileRecord } from "../lib/usage-ledger"
import { foldBalances, type Plan } from "../lib/allowance"
import { decideRequest, retryAfterSeconds } from "../lib/quota-decision"

const day = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d)
const iso = (n: number) => new Date(n).toISOString().slice(0, 10)

// Anchored on the 31st, which no short month can hold.
const long: BillingAnchor = { anchorDay: 31, startedAt: day(2025, 1, 31) }
// Anchored on the 10th, every month holds it.
const even: BillingAnchor = { anchorDay: 10, startedAt: day(2025, 1, 10) }

const upload = (at: number, size: number, success = true): UsageEvent =>
    ({ type: "upload", fileSize: size, at, success })
const download = (at: number, size: number, success = true): UsageEvent =>
    ({ type: "download", fileSize: size, at, success })
const listing = (at: number, size = 0): UsageEvent => ({ type: "list", fileSize: size, at, success: true })

const stored = (fileId: string, size: number, from: number, until?: number): FileRecord =>
    until === undefined ? { fileId, size, uploadedAt: from } : { fileId, size, uploadedAt: from, deletedAt: until }

const plan: Plan = {
    requestAllowance: 100,
    bandwidthAllowance: 1000,
    storageLimitBytes: 500,
    carryPeriods: 1,
}

describe("allowances and the bank", () => {
    const ledgerOf = (events: UsageEvent[], files: FileRecord[], upTo: number) =>
        buildLedger(even, events, files, upTo)

    it("opens the first period with an empty bank", () => {
        const balances = foldBalances(plan, ledgerOf([], [], day(2025, 1, 20)))
        expect(balances[0].carriedInRequests).toBe(0)
        expect(balances[0].requestCredit).toBe(100)
    })

    it("banks what a quiet period left unspent", () => {
        const balances = foldBalances(plan, ledgerOf([listing(day(2025, 1, 15))], [], day(2025, 2, 20)))
        expect(balances[0].requestsUsed).toBe(1)
        expect(balances[1].carriedInRequests).toBe(99)
        expect(balances[1].requestCredit).toBe(199)
    })

    it("holds the bank down to the plan's carry ceiling", () => {
        const balances = foldBalances(plan, ledgerOf([], [], day(2025, 3, 20)))
        expect(balances[1].requestCredit).toBe(200)
        expect(balances[2].carriedInRequests).toBe(100)
    })

    it("banks bandwidth the same way and to its own ceiling", () => {
        const balances = foldBalances(plan, ledgerOf([download(day(2025, 1, 15), 400)], [], day(2025, 2, 20)))
        expect(balances[0].bandwidthUsed).toBe(400)
        expect(balances[1].carriedInBandwidth).toBe(600)
        expect(balances[1].bandwidthCredit).toBe(1600)
    })

    it("reports how far past its credit each counter ran", () => {
        const events: UsageEvent[] = [
            ...Array.from({ length: 105 }, (_, i) => listing(day(2025, 1, 15) + i)),
            download(day(2025, 1, 16), 1500),
        ]
        const balances = foldBalances(plan, ledgerOf(events, [], day(2025, 1, 20)))
        expect(balances[0].requestOverage).toBe(6)
        expect(balances[0].bandwidthOverage).toBe(500)
    })

    it("banks nothing out of a period that ran past its credit", () => {
        const events = Array.from({ length: 105 }, (_, i) => listing(day(2025, 1, 15) + i))
        const balances = foldBalances(plan, ledgerOf(events, [], day(2025, 2, 20)))
        expect(balances[1].carriedInRequests).toBe(0)
        expect(balances[1].requestCredit).toBe(100)
    })

    it("lets the bank cover a period that would otherwise have run over", () => {
        const heavy = Array.from({ length: 150 }, (_, i) => listing(day(2025, 2, 15) + i))
        const balances = foldBalances(plan, ledgerOf(heavy, [], day(2025, 2, 20)))
        expect(balances[1].requestsUsed).toBe(150)
        expect(balances[1].requestOverage).toBe(0)
    })

    it("measures storage against the ceiling and not against a bank", () => {
        const files = [stored("a", 700, day(2025, 1, 15))]
        const balances = foldBalances(plan, ledgerOf([], files, day(2025, 3, 20)))
        expect(balances.map((b) => b.storageOverBytes)).toEqual([200, 200, 200])
    })

    it("calls a period clear when nothing ran past its limit", () => {
        const balances = foldBalances(plan, ledgerOf([listing(day(2025, 1, 15))], [], day(2025, 1, 20)))
        expect(balances[0].withinPlan).toBe(true)
    })

    it("calls a period unclear on storage alone", () => {
        const files = [stored("a", 900, day(2025, 1, 15))]
        const balances = foldBalances(plan, ledgerOf([], files, day(2025, 1, 20)))
        expect(balances[0].requestOverage).toBe(0)
        expect(balances[0].withinPlan).toBe(false)
    })

    it("places an instant in the period a boundary opens, not the one it closes", () => {
        const balances = foldBalances(plan, ledgerOf([], [], day(2025, 3, 20)))
        const idx = (at: number) => decideRequest(plan, balances, [], { type: "list", at }).periodIndex
        expect(idx(day(2025, 2, 15))).toBe(1)
        expect(idx(day(2025, 2, 10))).toBe(1)
        expect(idx(day(2025, 2, 10) - 1)).toBe(0)
    })

    it("covers no instant before the subscription opened", () => {
        const balances = foldBalances(plan, ledgerOf([], [], day(2025, 1, 20)))
        const decision = decideRequest(plan, balances, [], { type: "list", at: day(2024, 6, 1) })
        expect(decision.periodIndex).toBe(-1)
        expect(decision.reason).toBe("outside_subscription")
        expect(decision.bandwidthRemaining).toBe(0)
    })

    it("leaves the next period on its bare allowance when nothing may bank", () => {
        const strict: Plan = { ...plan, carryPeriods: 0 }
        const balances = foldBalances(strict, ledgerOf([], [], day(2025, 2, 20)))
        expect(balances[1].carriedInRequests).toBe(0)
        expect(balances[1].requestCredit).toBe(100)
    })

    it("lets a wider carry ceiling bank more than one period of allowance", () => {
        const roomy: Plan = { ...plan, carryPeriods: 3 }
        const balances = foldBalances(roomy, ledgerOf([], [], day(2025, 4, 20)))
        expect(balances[2].carriedInRequests).toBe(200)
        expect(balances[3].carriedInRequests).toBe(300)
    })

    it("folds one balance per ledger entry, in the order they were metered", () => {
        expect(foldBalances(plan, [])).toEqual([])
        const balances = foldBalances(plan, ledgerOf([], [], day(2025, 3, 20)))
        expect(balances.map((b) => b.index)).toEqual([0, 1, 2])
    })
})

describe("admitting the next request", () => {
    const at = day(2025, 1, 15)
    const balancesFor = (events: UsageEvent[], files: FileRecord[]) =>
        foldBalances(plan, buildLedger(even, events, files, at))

    it("admits a request that trips nothing", () => {
        const decision = decideRequest(plan, balancesFor([], []), [], { type: "list", at })
        expect(decision.verdict).toBe("admit")
        expect(decision.reason).toBe("within_plan")
    })

    it("reports the period it judged the request in", () => {
        expect(decideRequest(plan, balancesFor([], []), [], { type: "list", at }).periodIndex).toBe(0)
    })

    it("denies a request landing outside every period", () => {
        const decision = decideRequest(plan, balancesFor([], []), [], { type: "list", at: day(2024, 6, 1) })
        expect(decision.verdict).toBe("deny")
        expect(decision.reason).toBe("outside_subscription")
        expect(decision.periodIndex).toBe(-1)
    })

    it("leaves every remaining figure at zero outside every period", () => {
        const files = [stored("a", 120, day(2025, 1, 12))]
        const decision = decideRequest(plan, balancesFor([], files), files, { type: "list", at: day(2024, 6, 1) })
        expect(decision.requestsRemaining).toBe(0)
        expect(decision.bandwidthRemaining).toBe(0)
        expect(decision.storageRemainingBytes).toBe(0)
    })

    it("denies an upload the remaining storage cannot hold", () => {
        const files = [stored("a", 450, day(2025, 1, 12))]
        const decision = decideRequest(plan, balancesFor([], files), files, { type: "upload", sizeBytes: 90, at })
        expect(decision.verdict).toBe("deny")
        expect(decision.reason).toBe("storage_full")
        expect(decision.storageRemainingBytes).toBe(50)
    })

    it("admits an upload that exactly fills the remaining storage", () => {
        const files = [stored("a", 450, day(2025, 1, 12))]
        const decision = decideRequest(plan, balancesFor([], files), files, { type: "upload", sizeBytes: 50, at })
        expect(decision.verdict).toBe("admit")
    })

    it("does not weigh a download against storage", () => {
        const files = [stored("a", 500, day(2025, 1, 12))]
        const decision = decideRequest(plan, balancesFor([], files), files, { type: "download", sizeBytes: 90, at })
        expect(decision.reason).not.toBe("storage_full")
    })

    it("denies a transfer larger than the bandwidth left", () => {
        const decision = decideRequest(plan, balancesFor([download(day(2025, 1, 12), 950)], []), [], {
            type: "download", sizeBytes: 90, at,
        })
        expect(decision.verdict).toBe("deny")
        expect(decision.reason).toBe("bandwidth_exhausted")
        expect(decision.bandwidthRemaining).toBe(50)
    })

    it("throttles once the request credit is spent", () => {
        const events = Array.from({ length: 100 }, (_, i) => listing(day(2025, 1, 12) + i))
        const decision = decideRequest(plan, balancesFor(events, []), [], { type: "list", at })
        expect(decision.verdict).toBe("throttle")
        expect(decision.reason).toBe("requests_exhausted")
        expect(decision.requestsRemaining).toBe(0)
    })

    it("reports storage first when storage and bandwidth both stand in the way", () => {
        const files = [stored("a", 480, day(2025, 1, 12))]
        const decision = decideRequest(plan, balancesFor([download(day(2025, 1, 12), 990)], files), files, {
            type: "upload", sizeBytes: 60, at,
        })
        expect(decision.reason).toBe("storage_full")
    })

    it("reports bandwidth before requests when both stand in the way", () => {
        const events: UsageEvent[] = [
            ...Array.from({ length: 100 }, (_, i) => listing(day(2025, 1, 12) + i)),
            download(day(2025, 1, 13), 990),
        ]
        const decision = decideRequest(plan, balancesFor(events, []), [], { type: "download", sizeBytes: 60, at })
        expect(decision.reason).toBe("bandwidth_exhausted")
    })

    it("throttles a listing even when storage is full, since it moves nothing", () => {
        const files = [stored("a", 900, day(2025, 1, 12))]
        const events = Array.from({ length: 100 }, (_, i) => listing(day(2025, 1, 12) + i))
        const decision = decideRequest(plan, balancesFor(events, files), files, { type: "list", at })
        expect(decision.verdict).toBe("throttle")
    })

    it("measures the wait to the next boundary", () => {
        const balances = balancesFor([], [])
        const seconds = retryAfterSeconds(balances, day(2025, 2, 9) + 1500)
        expect(seconds).toBe(86399)
    })

    it("offers no wait when nothing covers the instant", () => {
        expect(retryAfterSeconds(balancesFor([], []), day(2024, 6, 1))).toBe(0)
    })

    it("weighs an upload against bandwidth once storage has room for it", () => {
        const decision = decideRequest(plan, balancesFor([download(day(2025, 1, 12), 960)], []), [], {
            type: "upload", sizeBytes: 60, at,
        })
        expect(decision.reason).toBe("bandwidth_exhausted")
    })

    it("reports every remaining figure on an admitted request", () => {
        const files = [stored("a", 200, day(2025, 1, 12))]
        const decision = decideRequest(plan, balancesFor([download(day(2025, 1, 12), 300)], files), files, {
            type: "list", at,
        })
        expect(decision.requestsRemaining).toBe(99)
        expect(decision.bandwidthRemaining).toBe(700)
        expect(decision.storageRemainingBytes).toBe(300)
    })
})

describe("more of the bank", () => {
    const ledgerOf = (events: UsageEvent[], files: FileRecord[], upTo: number) =>
        buildLedger(even, events, files, upTo)

    it("stacks two quiet periods against a wider carry ceiling", () => {
        const roomy: Plan = { ...plan, carryPeriods: 2 }
        const balances = foldBalances(roomy, ledgerOf([], [], day(2025, 4, 20)))
        expect(balances.map((b) => b.carriedInRequests)).toEqual([0, 100, 200, 200])
    })

    it("empties the bank after a period runs over and refills it after a quiet one", () => {
        const heavy = Array.from({ length: 250 }, (_, i) => listing(day(2025, 2, 15) + i))
        const balances = foldBalances(plan, ledgerOf(heavy, [], day(2025, 4, 20)))
        expect(balances[1].requestOverage).toBeGreaterThan(0)
        expect(balances[2].carriedInRequests).toBe(0)
        expect(balances[3].carriedInRequests).toBe(100)
    })

    it("keeps a storage overrun out of the next period's reckoning", () => {
        const files = [stored("a", 900, day(2025, 1, 15), day(2025, 1, 20))]
        const balances = foldBalances(plan, ledgerOf([], files, day(2025, 2, 20)))
        expect(balances[0].storageOverBytes).toBe(400)
        expect(balances[1].storageOverBytes).toBe(0)
    })

    it("banks requests and bandwidth independently of each other", () => {
        const events = [download(day(2025, 1, 15), 1000)]
        const balances = foldBalances(plan, ledgerOf(events, [], day(2025, 2, 20)))
        expect(balances[1].carriedInBandwidth).toBe(0)
        expect(balances[1].carriedInRequests).toBe(99)
    })

    it("calls a period unclear on a request overrun alone", () => {
        const events = Array.from({ length: 101 }, (_, i) => listing(day(2025, 1, 15) + i))
        const balances = foldBalances(plan, ledgerOf(events, [], day(2025, 1, 20)))
        expect(balances[0].storageOverBytes).toBe(0)
        expect(balances[0].withinPlan).toBe(false)
    })

    it("calls a period unclear on a bandwidth overrun alone", () => {
        const balances = foldBalances(plan, ledgerOf([download(day(2025, 1, 15), 1500)], [], day(2025, 1, 20)))
        expect(balances[0].requestOverage).toBe(0)
        expect(balances[0].bandwidthOverage).toBe(500)
        expect(balances[0].withinPlan).toBe(false)
    })
})

describe("more of the decision", () => {
    const at = day(2025, 1, 15)
    const balancesFor = (events: UsageEvent[], files: FileRecord[]) =>
        foldBalances(plan, buildLedger(even, events, files, at))

    it("admits a transfer that exactly spends the bandwidth left", () => {
        const decision = decideRequest(plan, balancesFor([download(day(2025, 1, 12), 900)], []), [], {
            type: "download", sizeBytes: 100, at,
        })
        expect(decision.verdict).toBe("admit")
    })

    it("never denies a deletion for want of storage", () => {
        const files = [stored("a", 900, day(2025, 1, 12))]
        const decision = decideRequest(plan, balancesFor([], files), files, { type: "delete", sizeBytes: 900, at })
        expect(decision.verdict).toBe("admit")
    })

    it("treats an upload with no size as moving nothing", () => {
        const files = [stored("a", 500, day(2025, 1, 12))]
        const decision = decideRequest(plan, balancesFor([], files), files, { type: "upload", at })
        expect(decision.verdict).toBe("admit")
        expect(decision.storageRemainingBytes).toBe(0)
    })

    it("judges the last millisecond of a period inside that period", () => {
        const balances = foldBalances(plan, buildLedger(even, [], [], day(2025, 2, 20)))
        const decision = decideRequest(plan, balances, [], { type: "list", at: day(2025, 2, 10) - 1 })
        expect(decision.periodIndex).toBe(0)
    })

    it("spans a full January to February gap from the opening instant", () => {
        const balances = foldBalances(plan, buildLedger(even, [], [], day(2025, 2, 20)))
        expect(retryAfterSeconds(balances, day(2025, 1, 10))).toBe(31 * 86400)
    })

    it("rounds a part second up to a whole one", () => {
        const balances = foldBalances(plan, buildLedger(even, [], [], day(2025, 2, 20)))
        expect(retryAfterSeconds(balances, day(2025, 2, 10) - 1000)).toBe(1)
    })
})
