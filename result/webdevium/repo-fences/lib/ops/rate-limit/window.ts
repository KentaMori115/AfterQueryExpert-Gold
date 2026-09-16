export type SlidingWindow = {
  timestamps: number[]
}

export function pruneWindow(window: SlidingWindow, now: number, windowMs: number) {
  const cutoff = now - windowMs
  let firstKept = 0
  while (firstKept < window.timestamps.length && window.timestamps[firstKept] <= cutoff) {
    firstKept += 1
  }
  if (firstKept > 0) {
    window.timestamps = window.timestamps.slice(firstKept)
  }
  return window
}

export function remainingInWindow(window: SlidingWindow, limit: number) {
  return Math.max(0, limit - window.timestamps.length)
}

export function admitAtWindowBoundary(
  window: SlidingWindow,
  now: number,
  windowMs: number,
  limit: number
) {
  pruneWindow(window, now, windowMs)
  if (window.timestamps.length >= limit) {
    const oldest = window.timestamps[0]
    return {
      allowed: false,
      remaining: 0,
      resetAt: oldest + windowMs,
    }
  }
  window.timestamps.push(now)
  return {
    allowed: true,
    remaining: remainingInWindow(window, limit),
    resetAt: (window.timestamps[0] ?? now) + windowMs,
  }
}
