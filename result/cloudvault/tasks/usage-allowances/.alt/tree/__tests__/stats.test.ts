import { aggregateUsageStats } from "../lib/stats"

describe("aggregateUsageStats", () => {
    it("returns zeros for an empty list", () => {
        expect(aggregateUsageStats([])).toEqual({
            totalRequests: 0,
            totalStorage: 0,
            totalBandwidth: 0,
        })
    })

    it("sums a single key's counters", () => {
        const result = aggregateUsageStats([
            { totalRequests: 10, totalStorage: 1000, totalBandwidth: 2000 },
        ])
        expect(result).toEqual({
            totalRequests: 10,
            totalStorage: 1000,
            totalBandwidth: 2000,
        })
    })

    it("sums across multiple keys", () => {
        const result = aggregateUsageStats([
            { totalRequests: 5, totalStorage: 100, totalBandwidth: 100 },
            { totalRequests: 7, totalStorage: 300, totalBandwidth: 400 },
            { totalRequests: 2, totalStorage: 50, totalBandwidth: 60 },
        ])
        expect(result).toEqual({
            totalRequests: 14,
            totalStorage: 450,
            totalBandwidth: 560,
        })
    })

    it("treats missing counters as zero", () => {
        const result = aggregateUsageStats([
            { totalRequests: 3 },
            { totalStorage: 5 },
            { totalBandwidth: 7 },
        ])
        expect(result).toEqual({
            totalRequests: 3,
            totalStorage: 5,
            totalBandwidth: 7,
        })
    })

    it("does not mutate the input array", () => {
        const input = [{ totalRequests: 1, totalStorage: 2, totalBandwidth: 3 }]
        const before = JSON.stringify(input)
        aggregateUsageStats(input)
        expect(JSON.stringify(input)).toBe(before)
    })

    it("handles null-ish counter values", () => {
        const result = aggregateUsageStats([
            { totalRequests: null as unknown as number, totalStorage: undefined as unknown as number, totalBandwidth: 1 },
        ])
        expect(result.totalRequests).toBe(0)
        expect(result.totalStorage).toBe(0)
        expect(result.totalBandwidth).toBe(1)
    })
})