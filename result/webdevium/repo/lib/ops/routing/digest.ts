export type Channel = 'inbox' | 'email' | 'sms'

export type RouteEvent = {
  id: string
  fingerprint: string
  priority: 'low' | 'medium' | 'high'
  at: number
  title: string
}

export type MuteWindow = {
  startHour: number
  endHour: number
}

export type RouteDecision = {
  eventId: string
  channel: Channel | 'digest'
  reason: string
}

const CHANNEL_BY_PRIORITY: Record<RouteEvent['priority'], Channel> = {
  low: 'inbox',
  medium: 'email',
  high: 'sms',
}

export function hourOf(at: number, tzOffsetMinutes = 0) {
  return new Date(at + tzOffsetMinutes * 60_000).getUTCHours()
}

export function inMuteWindow(at: number, mute: MuteWindow | null, tzOffsetMinutes = 0) {
  if (!mute) return false
  const hour = hourOf(at, tzOffsetMinutes)
  if (mute.startHour === mute.endHour) return false
  if (mute.startHour < mute.endHour) {
    return hour >= mute.startHour && hour < mute.endHour
  }
  return hour >= mute.startHour || hour < mute.endHour
}

export function routeNotifications(
  events: RouteEvent[],
  options: { mute: MuteWindow | null; digestLow: boolean; escalateAfterMs: number; tzOffsetMinutes?: number }
) {
  const seen = new Set<string>()
  const decisions: RouteDecision[] = []
  const lastHigh = new Map<string, number>()

  const ordered = [...events].sort((a, b) => a.at - b.at)
  for (const event of ordered) {
    if (seen.has(event.fingerprint) && event.priority !== 'high') {
      decisions.push({ eventId: event.id, channel: 'inbox', reason: 'deduped' })
      continue
    }
    seen.add(event.fingerprint)

    const muted = inMuteWindow(event.at, options.mute, options.tzOffsetMinutes)
    if (event.priority === 'low' && options.digestLow) {
      decisions.push({ eventId: event.id, channel: 'digest', reason: 'batched' })
      continue
    }
    if (muted && event.priority !== 'high') {
      decisions.push({ eventId: event.id, channel: 'digest', reason: 'muted' })
      continue
    }

    const previousHigh = lastHigh.get(event.fingerprint)
    if (
      event.priority === 'high' &&
      previousHigh !== undefined &&
      event.at - previousHigh >= options.escalateAfterMs
    ) {
      decisions.push({ eventId: event.id, channel: 'sms', reason: 'escalated' })
    } else {
      decisions.push({
        eventId: event.id,
        channel: CHANNEL_BY_PRIORITY[event.priority],
        reason: 'priority',
      })
    }
    if (event.priority === 'high') {
      lastHigh.set(event.fingerprint, event.at)
    }
  }

  return decisions
}
