import { describe, expect, it } from 'vitest'
import { createFrozenClock } from '@/lib/ops/clock'
import { delayForAttempt } from './backoff'
import { createJobQueue } from './queue'

const BACKOFF = { baseMs: 100, factor: 2, maxMs: 800, jitterRatio: 0 }

describe('createJobQueue', () => {
  it('reuses an idempotent enqueue instead of creating a duplicate', () => {
    const clock = createFrozenClock(0)
    const queue = createJobQueue(clock, { visibilityMs: 1_000, backoff: BACKOFF })

    const first = queue.enqueue({
      id: 'job-1',
      name: 'sync',
      payload: { n: 1 },
      idempotencyKey: 'client-9',
    })
    const second = queue.enqueue({
      id: 'job-2',
      name: 'sync',
      payload: { n: 2 },
      idempotencyKey: 'client-9',
    })

    expect(first).toEqual({ id: 'job-1', reused: false })
    expect(second).toEqual({ id: 'job-1', reused: true })
    expect(queue.size()).toBe(1)
  })

  it('leases the highest-priority available job and hides it for the visibility window', () => {
    const clock = createFrozenClock(0)
    const queue = createJobQueue(clock, { visibilityMs: 5_000, backoff: BACKOFF })

    queue.enqueue({ id: 'low', name: 'a', payload: {}, priority: 50 })
    queue.enqueue({ id: 'high', name: 'b', payload: {}, priority: 1 })

    const first = queue.claim()
    expect(first?.job.id).toBe('high')
    expect(first?.leaseUntil).toBe(5_000)
    expect(queue.claim()?.job.id).toBe('low')
    expect(queue.claim()).toBeNull()

    clock.advance(5_000)
    const recovered = queue.claim()
    expect(recovered?.job.id).toBe('high')
    expect(recovered?.job.attempts).toBe(2)
  })

  it('dead-letters a job after the last failed attempt', () => {
    const clock = createFrozenClock(0)
    const queue = createJobQueue(clock, { visibilityMs: 100, backoff: BACKOFF })

    queue.enqueue({ id: 'fragile', name: 'x', payload: {}, maxAttempts: 2 })
    queue.claim()
    expect(queue.fail('fragile', 'boom').deadLettered).toBe(false)
    clock.advance(200)
    queue.claim()
    expect(queue.fail('fragile', 'boom').deadLettered).toBe(true)
    expect(queue.deadLetters()[0]?.reason).toBe('boom')
    expect(queue.size()).toBe(0)
  })

  it('computes deterministic exponential backoff without wall-clock time', () => {
    expect(delayForAttempt(1, BACKOFF, 7)).toBe(100)
    expect(delayForAttempt(2, BACKOFF, 7)).toBe(200)
    expect(delayForAttempt(4, BACKOFF, 7)).toBe(800)
  })
})
