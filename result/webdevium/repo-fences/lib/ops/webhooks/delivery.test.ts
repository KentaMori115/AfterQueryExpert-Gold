import { describe, expect, it } from 'vitest'
import { createFrozenClock } from '@/lib/ops/clock'
import { createWebhookDispatcher } from './delivery'
import { signPayload } from './sign.js'

describe('webhook dispatcher', () => {
  it('retries failed deliveries on the fixed backoff schedule', () => {
    const clock = createFrozenClock(0)
    const statuses = [500, 500, 200]
    const dispatcher = createWebhookDispatcher(clock, 'hook-secret', () => ({
      status: statuses.shift() ?? 200,
    }))

    dispatcher.enqueue('wh-1', 'https://example.test/hook', '{"ok":true}')
    expect(dispatcher.tick()).toEqual(['wh-1'])
    expect(dispatcher.get('wh-1')?.deliveredAt).toBeNull()

    clock.advance(1_000)
    dispatcher.tick()
    clock.advance(5_000)
    dispatcher.tick()
    expect(dispatcher.get('wh-1')?.deliveredAt).toBe(6_000)
    expect(dispatcher.get('wh-1')?.attempts).toHaveLength(3)
  })

  it('rejects replayed signatures outside the window', () => {
    const clock = createFrozenClock(10_000)
    const dispatcher = createWebhookDispatcher(clock, 'hook-secret', () => ({ status: 200 }))
    const payload = '{"event":"task.done"}'
    const signature = signPayload('hook-secret', payload)

    expect(dispatcher.verifyReplay(payload, signature, 10_000, 5_000).ok).toBe(true)
    clock.advance(5_001)
    expect(dispatcher.verifyReplay(payload, signature, 10_000, 5_000)).toEqual({
      ok: false,
      reason: 'expired',
    })
    expect(dispatcher.verifyReplay(payload, 'deadbeef', 15_001, 5_000).reason).toBe('bad_signature')
  })
})
