import { describe, expect, it } from 'vitest'
import { createFrozenClock, type ControllableClock } from '@/lib/ops/clock'
import { createJobQueue } from '@/lib/ops/jobs/queue'

const BACKOFF = { baseMs: 100, factor: 2, maxMs: 800, jitterRatio: 0 }

function queueAt(startMs = 0, visibilityMs = 60_000) {
  const clock: ControllableClock = createFrozenClock(startMs)
  const queue = createJobQueue(clock, { visibilityMs, backoff: BACKOFF })
  return { clock, queue }
}

type EnqueueInput = {
  id: string
  name?: string
  payload?: Record<string, unknown>
  priority?: number
  maxAttempts?: number
  idempotencyKey?: string
  dependsOn?: string[]
}

function add(queue: ReturnType<typeof createJobQueue>, input: EnqueueInput) {
  return queue.enqueue({
    name: 'sync',
    payload: {},
    ...input,
  })
}

/** Take the job out of the queue and finish it, the way a worker would. */
function work(queue: ReturnType<typeof createJobQueue>, id: string) {
  const lease = queue.claim()
  expect(lease?.job.id).toBe(id)
  queue.complete(id)
  return lease
}

/** Fail one job until the queue gives up on it. */
function exhaust(queue: ReturnType<typeof createJobQueue>, clock: ControllableClock, id: string) {
  let last = { deadLettered: false } as { deadLettered: boolean }
  for (let round = 0; round < 8; round += 1) {
    const lease = queue.claim()
    if (!lease || lease.job.id !== id) {
      clock.advance(1_000)
      continue
    }
    last = queue.fail(id, 'boom')
    if (last.deadLettered) return last
    clock.advance(2_000)
  }
  return last
}

describe('fences', () => {
  it('holds a job behind a fence that has not been completed', () => {
    const { queue } = queueAt()

    add(queue, { id: 'build' })
    add(queue, { id: 'deploy', dependsOn: ['build'] })

    expect(queue.claim()?.job.id).toBe('build')
    expect(queue.claim()).toBeNull()
  })

  it('hands the fenced job out once its fence completes', () => {
    const { queue } = queueAt()

    add(queue, { id: 'build' })
    add(queue, { id: 'deploy', dependsOn: ['build'] })

    const lease = queue.claim()
    expect(lease?.job.id).toBe('build')
    expect(queue.claim()).toBeNull()
    queue.complete('build')

    expect(queue.claim()?.job.id).toBe('deploy')
  })

  it('still counts a job that is waiting behind a fence', () => {
    const { queue } = queueAt()

    add(queue, { id: 'build' })
    add(queue, { id: 'deploy', dependsOn: ['build'] })

    expect(queue.claim()?.job.id).toBe('build')
    expect(queue.size()).toBe(2)
    expect(queue.claim()).toBeNull()
  })

  it('refuses a fence on a job the queue has never seen', () => {
    const { queue } = queueAt()

    expect(() => add(queue, { id: 'deploy', dependsOn: ['nothing'] })).toThrow()
    expect(queue.size()).toBe(0)
  })

  it('takes a fence on a job that has already been completed', () => {
    const { queue } = queueAt()

    add(queue, { id: 'build' })
    work(queue, 'build')
    add(queue, { id: 'deploy', dependsOn: ['build'] })

    expect(queue.fencePlan().ready).toEqual(['deploy'])
    expect(queue.claim()?.job.id).toBe('deploy')
  })

  it('takes a fence on a job that is out with a worker and keeps waiting', () => {
    const { queue } = queueAt()

    add(queue, { id: 'build' })
    expect(queue.claim()?.job.id).toBe('build')
    add(queue, { id: 'deploy', dependsOn: ['build'] })

    expect(queue.claim()).toBeNull()
  })

  it('waits on every fence it was given, not only the first', () => {
    const { queue } = queueAt()

    add(queue, { id: 'build' })
    add(queue, { id: 'sign' })
    add(queue, { id: 'deploy', dependsOn: ['build', 'sign'] })

    work(queue, 'build')
    expect(queue.claim()?.job.id).toBe('sign')
    expect(queue.claim()).toBeNull()
    queue.complete('sign')
    expect(queue.claim()?.job.id).toBe('deploy')
  })

  it('keeps a fenced job away from a worker even when it outranks the rest', () => {
    const { queue } = queueAt()

    add(queue, { id: 'build', priority: 900 })
    add(queue, { id: 'deploy', priority: 1, dependsOn: ['build'] })

    expect(queue.claim()?.job.id).toBe('build')
  })
})

describe('coming down', () => {
  it('makes the released job available at the moment its last fence came down', () => {
    const { clock, queue } = queueAt()

    add(queue, { id: 'build' })
    add(queue, { id: 'deploy', dependsOn: ['build'] })
    expect(queue.claim()?.job.id).toBe('build')

    clock.advance(5_000)
    queue.complete('build')

    const lease = queue.claim()
    expect(lease?.job.id).toBe('deploy')
    expect(lease?.job.availableAt).toBe(5_000)
  })

  it('sends a released job to the back of work that has been waiting longer', () => {
    const { clock, queue } = queueAt()

    add(queue, { id: 'build' })
    add(queue, { id: 'ordinary', priority: 100 })
    add(queue, { id: 'urgent', priority: 1, dependsOn: ['build'] })

    expect(queue.claim()?.job.id).toBe('build')
    clock.advance(5_000)
    queue.complete('build')

    expect(queue.claim()?.job.id).toBe('ordinary')
    expect(queue.claim()?.job.id).toBe('urgent')
  })

  it('lets priority decide between two jobs released together', () => {
    const { clock, queue } = queueAt()

    add(queue, { id: 'build' })
    add(queue, { id: 'slow', priority: 50, dependsOn: ['build'] })
    add(queue, { id: 'quick', priority: 5, dependsOn: ['build'] })

    expect(queue.claim()?.job.id).toBe('build')
    clock.advance(1_000)
    queue.complete('build')

    expect(queue.claim()?.job.id).toBe('quick')
    expect(queue.claim()?.job.id).toBe('slow')
  })

  it('does not treat a retry as a fence coming down', () => {
    const { clock, queue } = queueAt()

    add(queue, { id: 'build' })
    add(queue, { id: 'deploy', dependsOn: ['build'] })

    expect(queue.claim()?.job.id).toBe('build')
    expect(queue.fail('build', 'flaky').deadLettered).toBe(false)
    clock.advance(1_000)

    expect(queue.claim()?.job.id).toBe('build')
  })

  it('does not treat an expired lease as a fence coming down', () => {
    const { clock, queue } = queueAt(0, 1_000)

    add(queue, { id: 'build' })
    add(queue, { id: 'deploy', dependsOn: ['build'] })

    expect(queue.claim()?.job.id).toBe('build')
    clock.advance(1_000)

    expect(queue.claim()?.job.id).toBe('build')
  })

  it('walks a chain of fences down one link at a time', () => {
    const { queue } = queueAt()

    add(queue, { id: 'one' })
    add(queue, { id: 'two', dependsOn: ['one'] })
    add(queue, { id: 'three', dependsOn: ['two'] })

    expect(queue.fencePlan().waiting.map((entry) => entry.id)).toEqual(['two', 'three'])
    work(queue, 'one')
    expect(queue.fencePlan().waiting.map((entry) => entry.id)).toEqual(['three'])
    work(queue, 'two')
    expect(queue.claim()?.job.id).toBe('three')
  })
})

describe('fences that never come down', () => {
  it('gives up on the job standing behind a dead letter', () => {
    const { clock, queue } = queueAt()

    add(queue, { id: 'build', maxAttempts: 1 })
    add(queue, { id: 'deploy', dependsOn: ['build'] })

    expect(exhaust(queue, clock, 'build').deadLettered).toBe(true)
    expect(queue.claim()).toBeNull()
    expect(queue.deadLetters().map((entry) => entry.job.id)).toEqual(['build', 'deploy'])
  })

  it('names the job that failed as the reason the rest were dropped', () => {
    const { clock, queue } = queueAt()

    add(queue, { id: 'build', maxAttempts: 1 })
    add(queue, { id: 'deploy', dependsOn: ['build'] })

    exhaust(queue, clock, 'build')
    expect(queue.deadLetters()[1]?.reason).toBe('blocked by build')
  })

  it('keeps the reason of the job that actually failed', () => {
    const { clock, queue } = queueAt()

    add(queue, { id: 'build', maxAttempts: 1 })
    add(queue, { id: 'deploy', dependsOn: ['build'] })

    exhaust(queue, clock, 'build')
    expect(queue.deadLetters()).toHaveLength(2)
    expect(queue.deadLetters()[0]?.reason).toBe('boom')
  })

  it('drops the whole chain, not only what stood directly behind it', () => {
    const { clock, queue } = queueAt()

    add(queue, { id: 'one', maxAttempts: 1 })
    add(queue, { id: 'two', dependsOn: ['one'] })
    add(queue, { id: 'three', dependsOn: ['two'] })

    exhaust(queue, clock, 'one')
    expect(queue.deadLetters().map((entry) => entry.job.id)).toEqual(['one', 'two', 'three'])
  })

  it('drops the chain one round at a time and in the order the jobs arrived', () => {
    const { clock, queue } = queueAt()

    add(queue, { id: 'root', maxAttempts: 1 })
    add(queue, { id: 'second', dependsOn: ['root'] })
    add(queue, { id: 'first', dependsOn: ['root'] })
    add(queue, { id: 'far', dependsOn: ['first'] })

    // `far` stands a round further out than the two jobs sitting straight
    // behind `root`, so it goes last even though `first` arrived after it.
    exhaust(queue, clock, 'root')
    expect(queue.deadLetters().map((entry) => entry.job.id)).toEqual([
      'root',
      'second',
      'first',
      'far',
    ])
  })

  it('gives up at once on a job enqueued behind a dead letter', () => {
    const { clock, queue } = queueAt()

    add(queue, { id: 'build', maxAttempts: 1 })
    exhaust(queue, clock, 'build')

    const answer = add(queue, { id: 'deploy', dependsOn: ['build'] })
    expect(answer).toEqual({ id: 'deploy', reused: false })
    expect(queue.size()).toBe(0)
    expect(queue.deadLetters().map((entry) => entry.reason)).toEqual(['boom', 'blocked by build'])
  })

  it('leaves the job waiting while its fence is only retrying', () => {
    const { clock, queue } = queueAt()

    add(queue, { id: 'build', maxAttempts: 3 })
    add(queue, { id: 'deploy', dependsOn: ['build'] })

    expect(queue.claim()?.job.id).toBe('build')
    queue.fail('build', 'flaky')
    clock.advance(1_000)

    expect(queue.deadLetters()).toEqual([])
    expect(queue.fencePlan().waiting).toEqual([{ id: 'deploy', blockedBy: ['build'], wave: 1 }])
  })

})

describe('the plan', () => {
  it('reads an empty queue as an empty plan', () => {
    const { queue } = queueAt()

    expect(queue.fencePlan()).toEqual({ ready: [], waiting: [], dead: [] })
  })

  it('lists what a worker would be handed, in the order it would come', () => {
    const { queue } = queueAt()

    add(queue, { id: 'low', priority: 50 })
    add(queue, { id: 'high', priority: 1 })
    add(queue, { id: 'middle', priority: 10 })

    expect(queue.fencePlan().ready).toEqual(['high', 'middle', 'low'])
  })

  it('leaves out a job that is not due yet', () => {
    const { clock, queue } = queueAt()

    add(queue, { id: 'build' })
    expect(queue.claim()?.job.id).toBe('build')
    queue.fail('build', 'flaky')

    expect(queue.fencePlan().ready).toEqual([])
    clock.advance(100)
    expect(queue.fencePlan().ready).toEqual(['build'])
  })

  it('leaves out a job that is out with a worker', () => {
    const { queue } = queueAt()

    add(queue, { id: 'build' })
    expect(queue.claim()?.job.id).toBe('build')

    const plan = queue.fencePlan()
    expect(plan.ready).toEqual([])
    expect(plan.waiting).toEqual([])
  })

  it('takes back a lease that has run out before answering', () => {
    const { clock, queue } = queueAt(0, 1_000)

    add(queue, { id: 'build' })
    expect(queue.claim()?.job.id).toBe('build')
    clock.advance(1_000)

    expect(queue.fencePlan().ready).toEqual(['build'])
  })

  it('leaves the queue as it found it', () => {
    const { queue } = queueAt()

    add(queue, { id: 'low', priority: 50 })
    add(queue, { id: 'high', priority: 1 })

    queue.fencePlan()
    expect(queue.claim()?.job.id).toBe('high')
    expect(queue.size()).toBe(2)
  })

  it('carries the fences a job is still waiting on, in the order they were given', () => {
    const { queue } = queueAt()

    add(queue, { id: 'build' })
    add(queue, { id: 'sign' })
    add(queue, { id: 'deploy', dependsOn: ['sign', 'build'] })

    expect(queue.fencePlan().waiting).toEqual([
      { id: 'deploy', blockedBy: ['sign', 'build'], wave: 1 },
    ])
  })

  it('drops a fence from the list once it has come down', () => {
    const { queue } = queueAt()

    add(queue, { id: 'build' })
    add(queue, { id: 'sign', priority: 1 })
    add(queue, { id: 'deploy', dependsOn: ['sign', 'build'] })

    work(queue, 'sign')
    expect(queue.fencePlan().waiting).toEqual([
      { id: 'deploy', blockedBy: ['build'], wave: 1 },
    ])
  })

  it('counts another round for every job in front that is waiting too', () => {
    const { queue } = queueAt()

    add(queue, { id: 'one' })
    add(queue, { id: 'two', dependsOn: ['one'] })
    add(queue, { id: 'three', dependsOn: ['two'] })
    add(queue, { id: 'four', dependsOn: ['three'] })

    expect(queue.fencePlan().waiting).toEqual([
      { id: 'two', blockedBy: ['one'], wave: 1 },
      { id: 'three', blockedBy: ['two'], wave: 2 },
      { id: 'four', blockedBy: ['three'], wave: 3 },
    ])
  })

  it('takes the deepest fence when a job waits on two rounds at once', () => {
    const { queue } = queueAt()

    add(queue, { id: 'one' })
    add(queue, { id: 'two', dependsOn: ['one'] })
    add(queue, { id: 'both', dependsOn: ['one', 'two'] })

    expect(queue.fencePlan().waiting).toEqual([
      { id: 'two', blockedBy: ['one'], wave: 1 },
      { id: 'both', blockedBy: ['one', 'two'], wave: 2 },
    ])
  })

  it('orders the waiting jobs round by round, and by arrival inside a round', () => {
    const { queue } = queueAt()

    add(queue, { id: 'one' })
    add(queue, { id: 'late', dependsOn: ['one'] })
    add(queue, { id: 'deep', dependsOn: ['late'] })
    add(queue, { id: 'early', dependsOn: ['one'] })

    expect(queue.fencePlan().waiting.map((entry) => entry.id)).toEqual([
      'late',
      'early',
      'deep',
    ])
  })

  it('keeps the dead letters in the order they were written down', () => {
    const { clock, queue } = queueAt()

    add(queue, { id: 'one', maxAttempts: 1 })
    add(queue, { id: 'two', dependsOn: ['one'] })
    add(queue, { id: 'three', dependsOn: ['two'] })

    exhaust(queue, clock, 'one')
    expect(queue.fencePlan().dead).toEqual([
      { id: 'one', reason: 'boom' },
      { id: 'two', reason: 'blocked by one' },
      { id: 'three', reason: 'blocked by one' },
    ])
  })
})

describe('fences and the rest of the queue', () => {
  it('keeps the fences a reused enqueue was given the first time', () => {
    const { queue } = queueAt()

    add(queue, { id: 'build' })
    add(queue, { id: 'first', idempotencyKey: 'client-9', dependsOn: ['build'] })
    const second = add(queue, { id: 'second', idempotencyKey: 'client-9' })

    expect(second).toEqual({ id: 'first', reused: true })
    expect(queue.fencePlan().waiting).toEqual([{ id: 'first', blockedBy: ['build'], wave: 1 }])
  })

  it('releases the work behind a job that was claimed and finished', () => {
    const { clock, queue } = queueAt()

    add(queue, { id: 'build' })
    add(queue, { id: 'deploy', dependsOn: ['build'] })

    const lease = queue.claim()
    expect(lease?.job.attempts).toBe(1)
    clock.advance(250)
    queue.complete('build')

    expect(queue.fencePlan().ready).toEqual(['deploy'])
  })

  it('lets a released job be retried on its own backoff', () => {
    const { clock, queue } = queueAt()

    add(queue, { id: 'build' })
    add(queue, { id: 'deploy', dependsOn: ['build'] })

    expect(queue.claim()?.job.id).toBe('build')
    expect(queue.claim()).toBeNull()
    queue.complete('build')

    expect(queue.claim()?.job.id).toBe('deploy')
    expect(queue.fail('deploy', 'flaky')).toEqual({ deadLettered: false, retryAt: 100 })
    expect(queue.claim()).toBeNull()
    clock.advance(100)
    expect(queue.claim()?.job.id).toBe('deploy')
  })

  it('holds a fenced job through a heartbeat on the job it waits for', () => {
    const { clock, queue } = queueAt(0, 1_000)

    add(queue, { id: 'build' })
    add(queue, { id: 'deploy', dependsOn: ['build'] })

    expect(queue.claim()?.job.id).toBe('build')
    clock.advance(500)
    expect(queue.heartbeat('build')).toBe(1_500)
    clock.advance(500)

    expect(queue.claim()).toBeNull()
  })
})
