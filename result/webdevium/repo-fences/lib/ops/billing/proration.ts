export type Plan = {
  id: string
  monthlyCents: number
  includedHours: number
  overageCentsPerHour: number
}

export type PlanChange = {
  at: number
  plan: Plan
}

export function overlapMs(start: number, end: number, windowStart: number, windowEnd: number) {
  const from = Math.max(start, windowStart)
  const to = Math.min(end, windowEnd)
  return Math.max(0, to - from)
}

export function prorateCycle(
  changes: PlanChange[],
  cycleStart: number,
  cycleEnd: number
) {
  if (changes.length === 0) {
    throw new Error('At least one plan is required')
  }
  const ordered = [...changes].sort((a, b) => a.at - b.at)
  const segments: { plan: Plan; start: number; end: number; ratio: number; cents: number }[] = []
  const duration = cycleEnd - cycleStart
  if (duration <= 0) {
    throw new Error('Cycle end must be after start')
  }

  for (let i = 0; i < ordered.length; i += 1) {
    const start = Math.max(ordered[i].at, cycleStart)
    const end = Math.min(i + 1 < ordered.length ? ordered[i + 1].at : cycleEnd, cycleEnd)
    const span = overlapMs(start, end, cycleStart, cycleEnd)
    if (span === 0) continue
    const ratio = span / duration
    segments.push({
      plan: ordered[i].plan,
      start,
      end,
      ratio,
      cents: Math.round(ordered[i].plan.monthlyCents * ratio),
    })
  }

  return {
    segments,
    subscriptionCents: segments.reduce((sum, segment) => sum + segment.cents, 0),
    includedHours: segments.reduce((sum, segment) => sum + segment.plan.includedHours * segment.ratio, 0),
  }
}
