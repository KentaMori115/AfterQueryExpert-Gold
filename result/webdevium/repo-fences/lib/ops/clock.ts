export type Clock = {
  now(): number
}

export type ControllableClock = Clock & {
  advance(ms: number): number
  set(ms: number): number
}

export function createFrozenClock(startMs = 0): ControllableClock {
  let current = startMs
  return {
    now: () => current,
    advance: (ms: number) => {
      if (ms < 0) {
        throw new Error('Clock cannot move backwards')
      }
      current += ms
      return current
    },
    set: (ms: number) => {
      if (ms < current) {
        throw new Error('Clock cannot move backwards')
      }
      current = ms
      return current
    },
  }
}

export function secondsFromMs(ms: number) {
  return Math.max(0, Math.ceil(ms / 1000))
}
