export type UsageStatus = 'On Track' | 'Approaching Limit' | 'Exceeded'

export function getUsageStatus(percent: number): UsageStatus {
  if (percent >= 100) return 'Exceeded'
  if (percent >= 80) return 'Approaching Limit'
  return 'On Track'
}

export function clampPercent(value: number) {
  if (Number.isNaN(value)) return 0
  return Math.min(100, Math.max(0, value))
}
