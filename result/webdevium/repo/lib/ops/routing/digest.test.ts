import { describe, expect, it } from 'vitest'
import { inMuteWindow, routeNotifications } from './digest'

describe('routeNotifications', () => {
  it('dedupes repeated low-priority fingerprints and batches them into a digest', () => {
    const decisions = routeNotifications(
      [
        { id: '1', fingerprint: 'task-9', priority: 'low', at: 0, title: 'a' },
        { id: '2', fingerprint: 'task-9', priority: 'low', at: 10, title: 'a' },
      ],
      { mute: null, digestLow: true, escalateAfterMs: 60_000 }
    )
    expect(decisions.map((item) => item.reason)).toEqual(['batched', 'deduped'])
  })

  it('holds medium alerts during a wrapping mute window but still sends high SMS', () => {
    expect(inMuteWindow(Date.UTC(2024, 0, 1, 23, 0, 0), { startHour: 22, endHour: 6 })).toBe(true)
    const mutedHour = Date.UTC(2024, 0, 1, 23, 0, 0)
    const decisions = routeNotifications(
      [
        { id: 'm', fingerprint: 'mid', priority: 'medium', at: mutedHour, title: 'm' },
        { id: 'h', fingerprint: 'hi', priority: 'high', at: mutedHour, title: 'h' },
      ],
      { mute: { startHour: 22, endHour: 6 }, digestLow: false, escalateAfterMs: 1_000 }
    )
    expect(decisions[0]).toMatchObject({ channel: 'digest', reason: 'muted' })
    expect(decisions[1]).toMatchObject({ channel: 'sms', reason: 'priority' })
  })

  it('escalates a repeated high alert after the quiet period', () => {
    const decisions = routeNotifications(
      [
        { id: 'h1', fingerprint: 'down', priority: 'high', at: 0, title: 'down' },
        { id: 'h2', fingerprint: 'down', priority: 'high', at: 2_000, title: 'down' },
      ],
      { mute: null, digestLow: false, escalateAfterMs: 1_000 }
    )
    expect(decisions[1]).toMatchObject({ channel: 'sms', reason: 'escalated' })
  })
})
