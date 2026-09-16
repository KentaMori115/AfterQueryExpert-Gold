import { describe, expect, it } from 'vitest'
import { createFrozenClock, secondsFromMs } from '@/lib/ops/clock'
import { delayForAttempt } from '@/lib/ops/jobs/backoff'
import { siftDown, siftUp, type Ranked } from '@/lib/ops/jobs/heap'
import { createJobQueue } from '@/lib/ops/jobs/queue'

const BACKOFF = { baseMs: 100, factor: 2, maxMs: 800, jitterRatio: 0 }
const JITTERED = { baseMs: 1_000, factor: 2, maxMs: 60_000, jitterRatio: 0.25 }

function ranked(entries: [number, number][]): Ranked<string>[] {
  return entries.map(([rank, tie]) => ({ rank, tie, value: `${rank}:${tie}` }))
}

describe('the heap keeps the order it always kept', () => {
  it('lifts a smaller rank to the top', () => {
    const items = ranked([
      [10, 0],
      [20, 1],
      [30, 2],
      [5, 3],
    ])

    siftUp(items, 3)
    expect(items[0].value).toBe('5:3')
  })

  it('leaves the earlier arrival in front when two ranks are equal', () => {
    const items = ranked([
      [10, 0],
      [10, 1],
    ])

    siftUp(items, 1)
    expect(items.map((item) => item.value)).toEqual(['10:0', '10:1'])
  })

  it('settles the top back down after it is replaced', () => {
    const items = ranked([
      [50, 0],
      [10, 1],
      [20, 2],
    ])

    siftDown(items, 0)
    expect(items[0].value).toBe('10:1')
  })
})

describe('backoff stays where it was', () => {
  it('grows by the factor on every attempt', () => {
    expect(delayForAttempt(1, BACKOFF, 7)).toBe(100)
    expect(delayForAttempt(2, BACKOFF, 7)).toBe(200)
    expect(delayForAttempt(3, BACKOFF, 7)).toBe(400)
  })

  it('stops growing at the ceiling', () => {
    expect(delayForAttempt(6, BACKOFF, 7)).toBe(800)
    expect(delayForAttempt(9, BACKOFF, 7)).toBe(800)
  })

  it('treats a first attempt as no growth at all', () => {
    expect(delayForAttempt(0, BACKOFF, 7)).toBe(100)
  })

  it('spreads a jittered delay around the exponential without wall-clock time', () => {
    const first = delayForAttempt(3, JITTERED, 11)
    const second = delayForAttempt(3, JITTERED, 11)

    expect(first).toBe(second)
    expect(first).toBeGreaterThanOrEqual(3_000)
    expect(first).toBeLessThanOrEqual(5_000)
  })
})

describe('the queue keeps its old bargains', () => {
  it('refuses a second job under an id it already holds', () => {
    const queue = createJobQueue(createFrozenClock(0), {
      visibilityMs: 1_000,
      backoff: BACKOFF,
    })

    queue.enqueue({ id: 'sync', name: 'sync', payload: {} })
    expect(() => queue.enqueue({ id: 'sync', name: 'sync', payload: {} })).toThrow()
  })

  it('answers nothing when there is nothing to hand out', () => {
    const queue = createJobQueue(createFrozenClock(0), {
      visibilityMs: 1_000,
      backoff: BACKOFF,
    })

    expect(queue.claim()).toBeNull()
    expect(queue.size()).toBe(0)
    expect(queue.deadLetters()).toEqual([])
  })

  it('hides a claimed job for the visibility window and hands it back after', () => {
    const clock = createFrozenClock(0)
    const queue = createJobQueue(clock, { visibilityMs: 5_000, backoff: BACKOFF })

    queue.enqueue({ id: 'sync', name: 'sync', payload: {} })
    expect(queue.claim()?.leaseUntil).toBe(5_000)
    expect(queue.claim()).toBeNull()

    clock.advance(5_000)
    expect(queue.claim()?.job.id).toBe('sync')
  })

  it('counts the attempts a job has cost across claims', () => {
    const clock = createFrozenClock(0)
    const queue = createJobQueue(clock, { visibilityMs: 1_000, backoff: BACKOFF })

    queue.enqueue({ id: 'sync', name: 'sync', payload: {}, maxAttempts: 5 })
    expect(queue.claim()?.job.attempts).toBe(1)
    clock.advance(1_000)
    expect(queue.claim()?.job.attempts).toBe(2)
  })

  it('pushes the lease out on a heartbeat', () => {
    const clock = createFrozenClock(0)
    const queue = createJobQueue(clock, { visibilityMs: 1_000, backoff: BACKOFF })

    queue.enqueue({ id: 'sync', name: 'sync', payload: {} })
    queue.claim()
    clock.advance(400)

    expect(queue.heartbeat('sync')).toBe(1_400)
  })

  it('refuses a heartbeat on a job nobody holds', () => {
    const queue = createJobQueue(createFrozenClock(0), {
      visibilityMs: 1_000,
      backoff: BACKOFF,
    })

    queue.enqueue({ id: 'sync', name: 'sync', payload: {} })
    expect(() => queue.heartbeat('sync')).toThrow()
    expect(() => queue.heartbeat('nothing')).toThrow()
  })

  it('refuses to finish a job it has never heard of', () => {
    const queue = createJobQueue(createFrozenClock(0), {
      visibilityMs: 1_000,
      backoff: BACKOFF,
    })

    expect(() => queue.complete('nothing')).toThrow()
    expect(() => queue.fail('nothing', 'boom')).toThrow()
  })

  it('waits out the backoff instead of giving up too early', () => {
    const clock = createFrozenClock(0)
    const queue = createJobQueue(clock, { visibilityMs: 1_000, backoff: BACKOFF })

    queue.enqueue({ id: 'sync', name: 'sync', payload: {}, maxAttempts: 3 })
    queue.claim()

    const outcome = queue.fail('sync', 'flaky')
    expect(outcome.deadLettered).toBe(false)
    expect(outcome.retryAt).toBe(100)
    expect(queue.claim()).toBeNull()

    clock.advance(100)
    expect(queue.claim()?.job.id).toBe('sync')
  })

  it('hands back its own list of dead letters, not the one it keeps', () => {
    const clock = createFrozenClock(0)
    const queue = createJobQueue(clock, { visibilityMs: 1_000, backoff: BACKOFF })

    queue.enqueue({ id: 'sync', name: 'sync', payload: {}, maxAttempts: 1 })
    queue.claim()
    queue.fail('sync', 'boom')

    const letters = queue.deadLetters()
    expect(letters).toHaveLength(1)
    letters.pop()
    expect(queue.deadLetters()).toHaveLength(1)
  })

  it('stops counting a job once it is finished', () => {
    const queue = createJobQueue(createFrozenClock(0), {
      visibilityMs: 1_000,
      backoff: BACKOFF,
    })

    queue.enqueue({ id: 'sync', name: 'sync', payload: {} })
    expect(queue.size()).toBe(1)
    queue.claim()
    queue.complete('sync')
    expect(queue.size()).toBe(0)
  })

  it('hands the most urgent job out first and then the rest', () => {
    const queue = createJobQueue(createFrozenClock(0), {
      visibilityMs: 1_000,
      backoff: BACKOFF,
    })

    queue.enqueue({ id: 'low', name: 'sync', payload: {}, priority: 50 })
    queue.enqueue({ id: 'high', name: 'sync', payload: {}, priority: 1 })

    expect(queue.claim()?.job.id).toBe('high')
    expect(queue.claim()?.job.id).toBe('low')
    expect(queue.claim()).toBeNull()
  })

  it('keeps the payload and the name it was handed', () => {
    const queue = createJobQueue(createFrozenClock(0), {
      visibilityMs: 1_000,
      backoff: BACKOFF,
    })

    queue.enqueue({ id: 'sync', name: 'nightly-sync', payload: { rows: 12 } })
    const lease = queue.claim()

    expect(lease?.job.name).toBe('nightly-sync')
    expect(lease?.job.payload).toEqual({ rows: 12 })
  })
})

describe('the clock stays as it is', () => {
  it('refuses to be moved backwards', () => {
    const clock = createFrozenClock(1_000)

    expect(() => clock.advance(-1)).toThrow()
    expect(() => clock.set(999)).toThrow()
    expect(clock.now()).toBe(1_000)
  })

  it('rounds a retry delay up to whole seconds', () => {
    expect(secondsFromMs(1)).toBe(1)
    expect(secondsFromMs(1_001)).toBe(2)
    expect(secondsFromMs(-5)).toBe(0)
  })
})
