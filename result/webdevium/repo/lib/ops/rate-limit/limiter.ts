import type { Clock } from '@/lib/ops/clock'
import { secondsFromMs } from '@/lib/ops/clock'
import { admitAtWindowBoundary, pruneWindow, type SlidingWindow } from './window'
import { msUntilToken, refillBucket, takeToken, type TokenBucket } from './bucket'

export const UNAUTHENTICATED_KEY = '__anonymous__'

export type RateLimitConfig = {
  authenticatedLimit: number
  authenticatedWindowMs: number
  anonymousLimit: number
  anonymousWindowMs: number
  burstCapacity: number
  refillPerSecond: number
}

export type RateLimitDecision = {
  allowed: boolean
  remaining: number
  retryAfterSeconds: number
  resetAt: number
  key: string
}

type KeyState = {
  window: SlidingWindow
  bucket: TokenBucket
}

export function createRateLimiter(config: RateLimitConfig, clock: Clock) {
  const states = new Map<string, KeyState>()
  const refillPerMs = config.refillPerSecond / 1000

  const getState = (key: string, now: number, capacity: number): KeyState => {
    const existing = states.get(key)
    if (existing) {
      refillBucket(existing.bucket, now, capacity, refillPerMs)
      return existing
    }
    const created: KeyState = {
      window: { timestamps: [] },
      bucket: { tokens: capacity, lastRefillAt: now },
    }
    states.set(key, created)
    return created
  }

  return {
    inspect(token?: string) {
      const key = token && token.length > 0 ? token : UNAUTHENTICATED_KEY
      const authenticated = key !== UNAUTHENTICATED_KEY
      const now = clock.now()
      const limit = authenticated ? config.authenticatedLimit : config.anonymousLimit
      const windowMs = authenticated ? config.authenticatedWindowMs : config.anonymousWindowMs
      const state = getState(key, now, config.burstCapacity)
      pruneWindow(state.window, now, windowMs)
      return {
        key,
        remaining: Math.max(
          0,
          Math.min(limit - state.window.timestamps.length, Math.floor(state.bucket.tokens))
        ),
        resetAt: (state.window.timestamps[0] ?? now) + windowMs,
      }
    },
    consume(token?: string): RateLimitDecision {
      const key = token && token.length > 0 ? token : UNAUTHENTICATED_KEY
      const authenticated = key !== UNAUTHENTICATED_KEY
      const now = clock.now()
      const limit = authenticated ? config.authenticatedLimit : config.anonymousLimit
      const windowMs = authenticated ? config.authenticatedWindowMs : config.anonymousWindowMs
      const state = getState(key, now, config.burstCapacity)

      const windowDecision = admitAtWindowBoundary(state.window, now, windowMs, limit)
      if (!windowDecision.allowed) {
        return {
          allowed: false,
          remaining: 0,
          retryAfterSeconds: secondsFromMs(windowDecision.resetAt - now),
          resetAt: windowDecision.resetAt,
          key,
        }
      }

      if (!takeToken(state.bucket)) {
        state.window.timestamps.pop()
        const wait = msUntilToken(state.bucket, refillPerMs)
        return {
          allowed: false,
          remaining: 0,
          retryAfterSeconds: secondsFromMs(wait),
          resetAt: now + wait,
          key,
        }
      }

      return {
        allowed: true,
        remaining: Math.min(windowDecision.remaining, Math.floor(state.bucket.tokens)),
        retryAfterSeconds: 0,
        resetAt: windowDecision.resetAt,
        key,
      }
    },
  }
}
