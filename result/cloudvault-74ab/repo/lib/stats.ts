// Pure aggregation helpers for API key usage statistics.

export interface UsageTotals {
    totalRequests: number
    totalStorage: number
    totalBandwidth: number
}

// Aggregate usage statistics from a list of API key usage records.
export function aggregateUsageStats(
    apiKeys: Array<Partial<UsageTotals>>,
): UsageTotals {
    const acc: UsageTotals = { totalRequests: 0, totalStorage: 0, totalBandwidth: 0 }
    return apiKeys.reduce<UsageTotals>((accumulator, key) => {
        accumulator.totalRequests += key.totalRequests || 0
        accumulator.totalStorage += key.totalStorage || 0
        accumulator.totalBandwidth += key.totalBandwidth || 0
        return accumulator
    }, acc)
}