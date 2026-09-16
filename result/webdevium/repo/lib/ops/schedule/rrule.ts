export type Frequency = 'daily' | 'weekly' | 'monthly'

export type Recurrence = {
  frequency: Frequency
  interval: number
  byWeekday?: number[]
  byMonthDay?: number
  count?: number
  until?: number
  exdates?: number[]
  tzOffsetMinutes?: number
}

const DAY = 86_400_000

export function startOfLocalDay(ms: number, tzOffsetMinutes: number) {
  const shifted = ms + tzOffsetMinutes * 60_000
  const aligned = Math.floor(shifted / DAY) * DAY
  return aligned - tzOffsetMinutes * 60_000
}

export function weekdayUtc(ms: number, tzOffsetMinutes: number) {
  const local = new Date(ms + tzOffsetMinutes * 60_000)
  return local.getUTCDay()
}

export function expandRecurrence(start: number, rule: Recurrence, horizon: number) {
  const tz = rule.tzOffsetMinutes ?? 0
  const dates: number[] = []
  const excluded = new Set(rule.exdates ?? [])
  let cursor = start
  let guard = 0

  while (dates.length < (rule.count ?? Number.POSITIVE_INFINITY) && cursor <= horizon) {
    guard += 1
    if (guard > 10_000) throw new Error('Recurrence expansion overflow')

    const candidate = cursor
    const allowedWeekday = !rule.byWeekday || rule.byWeekday.includes(weekdayUtc(candidate, tz))
    const local = new Date(candidate + tz * 60_000)
    const allowedMonthDay = rule.byMonthDay === undefined || local.getUTCDate() === rule.byMonthDay
    const beforeUntil = rule.until === undefined || candidate <= rule.until

    if (allowedWeekday && allowedMonthDay && beforeUntil && !excluded.has(candidate)) {
      dates.push(candidate)
    }

    if (rule.frequency === 'daily') {
      cursor += DAY * rule.interval
    } else if (rule.frequency === 'weekly') {
      cursor += DAY * 7 * rule.interval
    } else {
      const next = new Date(cursor + tz * 60_000)
      next.setUTCMonth(next.getUTCMonth() + rule.interval)
      cursor = next.getTime() - tz * 60_000
    }
  }

  return dates
}
