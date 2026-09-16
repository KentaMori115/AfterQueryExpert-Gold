import { describe, expect, it } from 'vitest'
import { createFrozenClock, secondsFromMs } from './clock'

describe('createFrozenClock', () => {
  it('only moves forward and rounds retry delays up to whole seconds', () => {
    const clock = createFrozenClock(1_000)
    expect(clock.now()).toBe(1_000)
    expect(clock.advance(250)).toBe(1_250)
    expect(() => clock.advance(-1)).toThrow(/backwards/)
    expect(() => clock.set(1_000)).toThrow(/backwards/)
    expect(secondsFromMs(1)).toBe(1)
    expect(secondsFromMs(0)).toBe(0)
  })
})
