export type VectorClock = Record<string, number>

export function tick(clock: VectorClock, actor: string): VectorClock {
  return { ...clock, [actor]: (clock[actor] ?? 0) + 1 }
}

export function mergeClocks(a: VectorClock, b: VectorClock): VectorClock {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  const next: VectorClock = {}
  for (const key of keys) {
    next[key] = Math.max(a[key] ?? 0, b[key] ?? 0)
  }
  return next
}

export function compareClocks(a: VectorClock, b: VectorClock): 'before' | 'after' | 'equal' | 'concurrent' {
  let less = false
  let greater = false
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    const left = a[key] ?? 0
    const right = b[key] ?? 0
    if (left < right) less = true
    if (left > right) greater = true
  }
  if (less && greater) return 'concurrent'
  if (less) return 'before'
  if (greater) return 'after'
  return 'equal'
}
