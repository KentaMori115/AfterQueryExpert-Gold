import type { UsageEvent } from './ledger'

/**
 * Which period a logged hour belongs to, and which logged hours count at all.
 *
 * A usage feed is not tidy. It replays, it carries other clients' work when a
 * caller pulls a whole table, and it reaches back before the cycle opened.
 * Everything that decides whether an event is this cycle's problem lives
 * here, so the allowance arithmetic downstream can assume a clean total.
 */
export type UsageWindow = {
  start: number
  end: number
}

/**
 * Start inclusive, end exclusive. An hour logged at the instant a plan
 * changes is the new plan's problem, so a boundary never bills twice and
 * never falls through the gap between two periods.
 */
export function windowHolds(window: UsageWindow, at: number) {
  return at >= window.start && at < window.end
}

export function windowOf(windows: UsageWindow[], at: number) {
  for (let index = 0; index < windows.length; index += 1) {
    if (windowHolds(windows[index], at)) return index
  }
  return -1
}

/**
 * The first copy of an event id is the one that bills. Later copies are
 * dropped whatever they claim, since a replayed message is not a second hour
 * of work, and a feed that redelivers is normal rather than exceptional.
 */
export function dedupeUsage(usage: UsageEvent[]) {
  const seen = new Set<string>()
  const unique: UsageEvent[] = []
  for (const event of usage) {
    if (seen.has(event.id)) continue
    seen.add(event.id)
    unique.push(event)
  }
  return unique
}

/**
 * Negative hours are a data fault rather than a credit. Refusing them here
 * keeps a bad row from quietly cancelling honest work somewhere else in the
 * same period.
 */
export function assertLoggable(event: UsageEvent) {
  if (!Number.isFinite(event.hours) || event.hours < 0) {
    throw new Error(`Usage event ${event.id} has invalid hours`)
  }
}

/**
 * Total the hours each window has to answer for. Work booked to another
 * client, or logged outside the cycle being closed, never reaches a window.
 */
export function totalUsageByWindow(
  windows: UsageWindow[],
  usage: UsageEvent[],
  clientId: string
) {
  const hours = windows.map(() => 0)
  for (const event of dedupeUsage(usage)) {
    if (event.clientId !== clientId) continue
    assertLoggable(event)
    const index = windowOf(windows, event.at)
    if (index === -1) continue
    hours[index] += event.hours
  }
  return hours
}
