import { periodByIndex, periodAt, type BillingAnchor } from "../lib/billing-period"
import { buildLedger, type UsageEvent, type FileRecord } from "../lib/usage-ledger"

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

const starts = (anchor: BillingAnchor, i: number) => iso(periodByIndex(anchor, i).startsAt)

const stored = (fileId: string, size: number, from: number, until?: number): FileRecord =>
    until === undefined ? { fileId, size, uploadedAt: from } : { fileId, size, uploadedAt: from, deletedAt: until }

describe("anchor clamping", () => {
    it("settles a 31st anchor onto the end of February", () => {
        expect(starts(long, 1)).toBe("2025-02-28")
    })

    it("leaves an anchor the month can hold alone", () => {
        expect(starts(long, 2)).toBe("2025-03-31")
    })

    it("settles onto the leap day in a leap February", () => {
        const leapJan: BillingAnchor = { anchorDay: 31, startedAt: day(2024, 1, 31) }
        expect(starts(leapJan, 1)).toBe("2024-02-29")
    })

    it("settles a 30th anchor in February and leaves it in April", () => {
        const thirtieth: BillingAnchor = { anchorDay: 30, startedAt: day(2025, 1, 30) }
        expect(starts(thirtieth, 1)).toBe("2025-02-28")
        expect(starts(thirtieth, 3)).toBe("2025-04-30")
    })

    it("treats an anchor day below 1 as 1", () => {
        const odd: BillingAnchor = { anchorDay: 0, startedAt: day(2025, 1, 15) }
        expect(starts(odd, 0)).toBe("2025-01-01")
    })
})

describe("period boundaries", () => {
    it("opens period 0 on the anchor when the subscription began there", () => {
        expect(starts(long, 0)).toBe("2025-01-31")
    })

    it("opens period 0 in the month before when the anchor had not yet come", () => {
        const mid: BillingAnchor = { anchorDay: 31, startedAt: day(2025, 1, 15) }
        expect(starts(mid, 0)).toBe("2024-12-31")
    })

    it("does not let a settled boundary drag the anchor down", () => {
        expect(starts(long, 1)).toBe("2025-02-28")
        expect(starts(long, 2)).toBe("2025-03-31")
    })

    it("keeps returning to the original anchor after every short month", () => {
        expect(starts(long, 3)).toBe("2025-04-30")
        expect(starts(long, 4)).toBe("2025-05-31")
    })

    it("closes a period where the next one opens", () => {
        const first = periodByIndex(long, 0)
        expect(first.endsAt).toBe(periodByIndex(long, 1).startsAt)
    })

    it("carries the index it was asked for", () => {
        expect(periodByIndex(even, 7).index).toBe(7)
    })
})

describe("locating a period", () => {
    it("finds the period holding an instant inside it", () => {
        expect(periodAt(long, day(2025, 2, 10))!.index).toBe(0)
    })

    it("puts an instant exactly on a boundary in the period it opens", () => {
        expect(periodAt(long, day(2025, 2, 28))!.index).toBe(1)
    })

    it("puts the instant one millisecond earlier in the period before", () => {
        expect(periodAt(long, day(2025, 2, 28) - 1)!.index).toBe(0)
    })

    it("answers with nothing before the subscription opened", () => {
        expect(periodAt(long, day(2024, 12, 1))).toBeNull()
    })

    it("reaches periods far from the start", () => {
        expect(periodAt(even, day(2026, 1, 15))!.index).toBe(12)
    })
})

describe("the stored level", () => {
    // Read through the ledger: a period's peak is the highest the level reached
    // inside it, so placing changes on boundaries pins inclusive and exclusive.
    const peaks = (files: FileRecord[], upTo: number) =>
        buildLedger(even, [], files, upTo).map((p) => p.peakStoredBytes)

    it("shows nothing in the period before a file arrives", () => {
        expect(peaks([stored("a", 100, day(2025, 2, 10))], day(2025, 2, 20))).toEqual([0, 100])
    })

    it("counts a file from the very instant it was uploaded", () => {
        expect(peaks([stored("a", 100, day(2025, 2, 10) - 1)], day(2025, 2, 20))).toEqual([100, 100])
    })

    it("stops counting a file at the instant it was deleted", () => {
        expect(peaks([stored("a", 100, day(2025, 1, 15), day(2025, 2, 10))], day(2025, 2, 20))).toEqual([100, 0])
    })

    it("never counts a file deleted the instant it arrived", () => {
        expect(peaks([stored("z", 90, day(2025, 1, 15), day(2025, 1, 15))], day(2025, 1, 20))).toEqual([0])
    })

    it("adds up several files held at once", () => {
        const files = [
            stored("a", 100, day(2025, 1, 12)),
            stored("b", 200, day(2025, 1, 13)),
            stored("c", 300, day(2025, 1, 14)),
        ]
        expect(peaks(files, day(2025, 1, 20))).toEqual([600])
    })

    it("falls back to nothing once every file has gone", () => {
        const files = [
            stored("a", 100, day(2025, 1, 12), day(2025, 2, 10)),
            stored("b", 200, day(2025, 1, 13), day(2025, 2, 10)),
        ]
        const ledger = buildLedger(even, [], files, day(2025, 2, 20))
        expect(ledger[1].peakStoredBytes).toBe(0)
        expect(ledger[1].closingStoredBytes).toBe(0)
    })

    it("ignores a file reporting a size of zero", () => {
        expect(peaks([stored("a", 0, day(2025, 1, 12))], day(2025, 1, 20))).toEqual([0])
    })

    it("counts nothing at all when no file has been stored", () => {
        expect(peaks([], day(2025, 1, 20))).toEqual([0])
    })
})

describe("metering a period", () => {
    it("counts every event, failed ones included", () => {
        const events = [upload(day(2025, 2, 1), 10), download(day(2025, 2, 2), 10, false), listing(day(2025, 2, 3))]
        const ledger = buildLedger(even, events, [], day(2025, 2, 5))
        expect(ledger[0].requests).toBe(3)
    })

    it("sums bandwidth over successful uploads and downloads only", () => {
        const events = [upload(day(2025, 1, 15), 10), download(day(2025, 1, 16), 25), download(day(2025, 1, 17), 60, false)]
        const ledger = buildLedger(even, events, [], day(2025, 1, 20))
        expect(ledger[0].bandwidthBytes).toBe(35)
    })

    it("moves no bandwidth on a listing that reports a size anyway", () => {
        const ledger = buildLedger(even, [listing(day(2025, 1, 15), 700)], [], day(2025, 1, 20))
        expect(ledger[0].bandwidthBytes).toBe(0)
    })

    it("moves no bandwidth on a deletion whatever size it reports", () => {
        const events: UsageEvent[] = [{ type: "delete", fileSize: 800, at: day(2025, 1, 15), success: true }]
        const ledger = buildLedger(even, events, [], day(2025, 1, 20))
        expect(ledger[0].requests).toBe(1)
        expect(ledger[0].bandwidthBytes).toBe(0)
    })

    it("adds nothing to bandwidth when an upload reports no bytes", () => {
        const events: UsageEvent[] = [{ type: "upload", at: day(2025, 1, 15), success: true }]
        expect(buildLedger(even, events, [], day(2025, 1, 20))[0].bandwidthBytes).toBe(0)
    })

    it("sorts events into periods however they arrive", () => {
        const events = [upload(day(2025, 3, 15), 5), upload(day(2025, 1, 15), 5), upload(day(2025, 2, 15), 5)]
        const ledger = buildLedger(even, events, [], day(2025, 3, 20))
        expect(ledger.map((p) => p.requests)).toEqual([1, 1, 1])
    })
})

describe("storage across periods", () => {
    it("carries a level into a period that saw no events at all", () => {
        const files = [stored("a", 300, day(2025, 1, 15))]
        const ledger = buildLedger(even, [], files, day(2025, 3, 20))
        expect(ledger.map((p) => p.peakStoredBytes)).toEqual([300, 300, 300])
    })

    it("takes the peak rather than the closing level", () => {
        const files = [stored("a", 300, day(2025, 1, 15), day(2025, 1, 20))]
        const ledger = buildLedger(even, [], files, day(2025, 1, 25))
        expect(ledger[0].peakStoredBytes).toBe(300)
        expect(ledger[0].closingStoredBytes).toBe(0)
    })

    it("reports the level the period closed on", () => {
        const files = [
            stored("a", 300, day(2025, 1, 15)),
            stored("b", 50, day(2025, 1, 20), day(2025, 1, 25)),
            stored("c", 70, day(2025, 2, 10)),
        ]
        const ledger = buildLedger(even, [], files, day(2025, 1, 28))
        expect(ledger[0].peakStoredBytes).toBe(350)
        expect(ledger[0].closingStoredBytes).toBe(300)
    })

    it("counts a level that only rose in an earlier period as this period's peak", () => {
        const files = [stored("a", 400, day(2025, 1, 15)), stored("b", 100, day(2025, 2, 15))]
        const ledger = buildLedger(even, [], files, day(2025, 2, 20))
        expect(ledger[1].peakStoredBytes).toBe(500)
    })

    it("drops the level for a file deleted in an earlier period", () => {
        const files = [stored("a", 400, day(2025, 1, 15), day(2025, 1, 25))]
        const ledger = buildLedger(even, [], files, day(2025, 2, 20))
        expect(ledger[1].peakStoredBytes).toBe(0)
    })

    it("meters one period per boundary crossed up to the closing instant", () => {
        const ledger = buildLedger(even, [], [], day(2025, 4, 1))
        expect(ledger.map((p) => p.index)).toEqual([0, 1, 2])
    })

    it("includes the period a closing instant opens", () => {
        const ledger = buildLedger(even, [], [], day(2025, 3, 10))
        expect(ledger.map((p) => p.index)).toEqual([0, 1, 2])
    })

    it("leaves an event after the closing instant out of the count", () => {
        const ledger = buildLedger(even, [listing(day(2025, 5, 1))], [], day(2025, 2, 20))
        expect(ledger.map((p) => p.requests)).toEqual([0, 0])
    })
})

describe("a year of boundaries", () => {
    it("walks a 15th anchor through every month of a common year", () => {
        const mid: BillingAnchor = { anchorDay: 15, startedAt: day(2025, 1, 15) }
        const walk = Array.from({ length: 12 }, (_, i) => starts(mid, i))
        expect(walk[1]).toBe("2025-02-15")
        expect(walk[11]).toBe("2025-12-15")
    })

    it("carries an anchor across the turn of the year", () => {
        const yearEnd: BillingAnchor = { anchorDay: 31, startedAt: day(2025, 12, 31) }
        expect(starts(yearEnd, 1)).toBe("2026-01-31")
        expect(starts(yearEnd, 2)).toBe("2026-02-28")
    })

    it("keeps a 29th anchor through a leap February and a common one", () => {
        const leap: BillingAnchor = { anchorDay: 29, startedAt: day(2024, 1, 29) }
        expect(starts(leap, 1)).toBe("2024-02-29")
        const common: BillingAnchor = { anchorDay: 29, startedAt: day(2025, 1, 29) }
        expect(starts(common, 1)).toBe("2025-02-28")
    })

    it("gives every month of a leap year a boundary of its own", () => {
        const mid: BillingAnchor = { anchorDay: 15, startedAt: day(2024, 1, 15) }
        const walk = Array.from({ length: 12 }, (_, i) => starts(mid, i))
        expect(new Set(walk).size).toBe(12)
        expect(walk[1]).toBe("2024-02-15")
    })
})

describe("more of the stored level", () => {
    it("counts a file uploaded exactly when a period opens", () => {
        const files = [stored("a", 250, day(2025, 2, 10))]
        const ledger = buildLedger(even, [], files, day(2025, 2, 20))
        expect(ledger[1].peakStoredBytes).toBe(250)
        expect(ledger[0].peakStoredBytes).toBe(0)
    })

    it("counts requests separately in each period", () => {
        const events = [listing(day(2025, 1, 15)), listing(day(2025, 1, 16)), listing(day(2025, 2, 15))]
        const ledger = buildLedger(even, events, [], day(2025, 2, 20))
        expect(ledger.map((p) => p.requests)).toEqual([2, 1])
    })

    it("adds uploads and downloads into one bandwidth figure", () => {
        const events = [upload(day(2025, 1, 15), 40), download(day(2025, 1, 16), 60)]
        expect(buildLedger(even, events, [], day(2025, 1, 20))[0].bandwidthBytes).toBe(100)
    })

    it("meters only the opening period when nothing has closed yet", () => {
        const ledger = buildLedger(even, [], [], day(2025, 1, 11))
        expect(ledger.map((p) => p.index)).toEqual([0])
    })
})

describe("the stretch of period 0 before the subscription", () => {
    // anchorDay 31 with a mid-month start: period 0 opens 2024-12-31, well
    // before the subscription began on 2025-01-15.
    const late: BillingAnchor = { anchorDay: 31, startedAt: day(2025, 1, 15) }

    it("opens period 0 before the subscription began", () => {
        expect(starts(late, 0)).toBe("2024-12-31")
    })

    it("leaves an event on that earlier stretch out of the count", () => {
        const ledger = buildLedger(late, [listing(day(2025, 1, 5))], [], day(2025, 1, 20))
        expect(ledger[0].requests).toBe(0)
    })

    it("counts an event landing exactly on the opening instant", () => {
        const ledger = buildLedger(late, [listing(day(2025, 1, 15))], [], day(2025, 1, 20))
        expect(ledger[0].requests).toBe(1)
    })

    it("leaves bandwidth moved before the subscription out of the sum", () => {
        const events = [download(day(2025, 1, 3), 500), download(day(2025, 1, 16), 70)]
        const ledger = buildLedger(late, events, [], day(2025, 1, 20))
        expect(ledger[0].bandwidthBytes).toBe(70)
    })

    it("takes the peak from the subscription onward, not from the boundary", () => {
        const files = [stored("a", 400, day(2025, 1, 2), day(2025, 1, 10))]
        const ledger = buildLedger(late, [], files, day(2025, 1, 20))
        expect(ledger[0].peakStoredBytes).toBe(0)
    })

    it("still counts a file that was already stored when the subscription began", () => {
        const files = [stored("a", 400, day(2025, 1, 2))]
        const ledger = buildLedger(late, [], files, day(2025, 1, 20))
        expect(ledger[0].peakStoredBytes).toBe(400)
    })
})
