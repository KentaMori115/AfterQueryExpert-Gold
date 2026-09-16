import { describe, expect, it } from 'vitest'
import { createFrozenClock } from '@/lib/ops/clock'
import { createRateLimiter, UNAUTHENTICATED_KEY } from './limiter'

const BASE = {
  authenticatedLimit: 3,
  authenticatedWindowMs: 60_000,
  anonymousLimit: 2,
  anonymousWindowMs: 60_000,
  burstCapacity: 2,
  refillPerSecond: 1,
}

describe('createRateLimiter', () => {
  it('admits authenticated traffic until the rolling window is full', () => {
    const clock = createFrozenClock(1_000_000)
    const limiter = createRateLimiter(BASE, clock)

    expect(limiter.consume('tok-a').allowed).toBe(true)
    expect(limiter.consume('tok-a').allowed).toBe(true)
    const last = limiter.consume('tok-a')
    expect(last.allowed).toBe(false)
    expect(last.remaining).toBe(0)
    expect(last.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('keeps per-token windows isolated', () => {
    const clock = createFrozenClock(1_000_000)
    const limiter = createRateLimiter(BASE, clock)

    limiter.consume('alpha')
    limiter.consume('alpha')
    expect(limiter.consume('beta').allowed).toBe(true)
    expect(limiter.consume('alpha').allowed).toBe(false)
  })

  it('shares one anonymous bucket and uses a tighter cap', () => {
    const clock = createFrozenClock(1_000_000)
    const limiter = createRateLimiter(BASE, clock)

    expect(limiter.consume().key).toBe(UNAUTHENTICATED_KEY)
    expect(limiter.consume('').allowed).toBe(true)
    expect(limiter.consume().allowed).toBe(false)
  })

  it('admits a request that lands exactly when the oldest timestamp leaves the window', () => {
    const clock = createFrozenClock(10_000)
    const limiter = createRateLimiter({ ...BASE, burstCapacity: 4, authenticatedLimit: 2 }, clock)

    limiter.consume('tok')
    clock.advance(30_000)
    limiter.consume('tok')
    clock.set(10_000 + 60_000)
    const decision = limiter.consume('tok')
    expect(decision.allowed).toBe(true)
    expect(decision.remaining).toBe(0)
  })

  it('rejects a burst that fits the window but empties the token bucket', () => {
    const clock = createFrozenClock(0)
    const limiter = createRateLimiter(
      { ...BASE, authenticatedLimit: 10, burstCapacity: 1, refillPerSecond: 0 },
      clock
    )

    expect(limiter.consume('tok').allowed).toBe(true)
    const denied = limiter.consume('tok')
    expect(denied.allowed).toBe(false)
    expect(denied.retryAfterSeconds).toBeGreaterThan(0)
  })
})
