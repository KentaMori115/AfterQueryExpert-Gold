import type { Clock } from '@/lib/ops/clock'
import { delayForAttempt, type BackoffPolicy } from './backoff'
import { createFenceBook, UnknownFenceError, type FenceWait } from './fences'
import { siftDown, siftUp, type Ranked } from './heap'

export type JobPayload = Record<string, unknown>

export type QueuedJob = {
  id: string
  name: string
  payload: JobPayload
  priority: number
  attempts: number
  maxAttempts: number
  availableAt: number
  leaseUntil: number | null
  idempotencyKey?: string
  dependsOn?: string[]
}

export type Lease = {
  job: QueuedJob
  leaseUntil: number
}

export type DeadLetter = {
  job: QueuedJob
  reason: string
}

/**
 * What the queue is about to do.
 *
 * `ready` is the work a worker would be handed and the order it would come in,
 * `waiting` is the work held behind a fence, and `dead` is the work that will
 * never run. A job out with a worker is in none of the three.
 */
export type FencePlan = {
  ready: string[]
  waiting: FenceWait[]
  dead: { id: string; reason: string }[]
}

type QueueOptions = {
  visibilityMs: number
  backoff: BackoffPolicy
}

type HeapJob = Ranked<QueuedJob>

export function createJobQueue(clock: Clock, options: QueueOptions) {
  const heap: HeapJob[] = []
  const byId = new Map<string, QueuedJob>()
  const leased = new Map<string, QueuedJob>()
  const idempotent = new Map<string, string>()
  const dead: DeadLetter[] = []
  const fences = createFenceBook()
  const waiting = new Set<string>()
  const arrival = new Map<string, number>()
  let sequence = 0

  const recoverExpired = (now: number) => {
    for (const job of [...leased.values()]) {
      if ((job.leaseUntil ?? 0) <= now) {
        job.leaseUntil = null
        leased.delete(job.id)
        reheap(job)
      }
    }
  }

  const reheap = (job: QueuedJob) => {
    const index = heap.findIndex((item) => item.value.id === job.id)
    if (index === -1) {
      heap.push({ rank: job.availableAt * 1000 + job.priority, tie: sequence++, value: job })
      siftUp(heap, heap.length - 1)
      return
    }
    heap[index].rank = job.availableAt * 1000 + job.priority
    siftUp(heap, index)
    siftDown(heap, index)
  }

  // A job is known once the queue has seen the id, whether it is still in hand
  // or has already finished one way or the other.
  const known = (id: string) => byId.has(id) || fences.settled(id)

  // The queue drops the job and everything standing behind it in one go, so a
  // fence that can never come down never leaves work parked forever.
  const bury = (job: QueuedJob, reason: string) => {
    byId.delete(job.id)
    leased.delete(job.id)
    waiting.delete(job.id)
    job.leaseUntil = null
    fences.settle(job.id, 'dead')
    dead.push({ job, reason })
  }

  const collapse = (rootId: string) => {
    for (const blockedId of fences.cascadeFrom(rootId)) {
      const blocked = byId.get(blockedId)
      if (!blocked) continue
      bury(blocked, `blocked by ${rootId}`)
    }
  }

  // Completing is the only thing that brings a fence down. Whatever was left
  // waiting on nothing else becomes available at that instant and takes its
  // place by the ranking the queue already uses.
  const release = (fenceId: string) => {
    const now = clock.now()
    for (const jobId of fences.releasedBy(fenceId)) {
      if (!waiting.has(jobId)) continue
      const job = byId.get(jobId)
      if (!job) continue
      waiting.delete(jobId)
      job.availableAt = now
      reheap(job)
    }
  }

  const rankedOrder = () =>
    [...heap].sort((a, b) => a.rank - b.rank || a.tie - b.tie).map((item) => item.value)

  return {
    /**
     * Put a job in the queue, optionally behind other jobs.
     *
     * `dependsOn` names jobs the queue has already seen, whether they are
     * still in its hands or have already finished. A job with a fence still
     * standing is held: it counts against `size`, and no worker is offered it
     * however well it ranks. A fence on an id the queue has never seen is
     * refused outright, because parking the job forever would only hide the
     * mistake. A fence that has already been dead-lettered can never come
     * down, so the job is dead-lettered on arrival rather than held.
     */
    enqueue(input: {
      id: string
      name: string
      payload: JobPayload
      priority?: number
      maxAttempts?: number
      idempotencyKey?: string
      dependsOn?: string[]
    }) {
      if (input.idempotencyKey && idempotent.has(input.idempotencyKey)) {
        const existingId = idempotent.get(input.idempotencyKey)!
        return { id: existingId, reused: true }
      }
      if (byId.has(input.id)) {
        throw new Error(`Job ${input.id} already exists`)
      }
      const fenceIds = input.dependsOn ?? []
      for (const fenceId of fenceIds) {
        if (!known(fenceId)) {
          throw new UnknownFenceError(input.id, fenceId)
        }
      }
      const job: QueuedJob = {
        id: input.id,
        name: input.name,
        payload: input.payload,
        priority: input.priority ?? 100,
        attempts: 0,
        maxAttempts: input.maxAttempts ?? 3,
        availableAt: clock.now(),
        leaseUntil: null,
        idempotencyKey: input.idempotencyKey,
      }
      if (fenceIds.length > 0) {
        job.dependsOn = [...fenceIds]
      }
      arrival.set(job.id, arrival.size)
      fences.record(job.id, fenceIds)
      if (job.idempotencyKey) {
        idempotent.set(job.idempotencyKey, job.id)
      }

      const broken = fences.brokenBy(job.id)
      if (broken) {
        bury(job, `blocked by ${broken}`)
        return { id: job.id, reused: false }
      }

      byId.set(job.id, job)
      if (fences.outstanding(job.id).length > 0) {
        waiting.add(job.id)
        return { id: job.id, reused: false }
      }
      reheap(job)
      return { id: job.id, reused: false }
    },
    claim(workerNow = clock.now()): Lease | null {
      recoverExpired(workerNow)
      if (heap.length === 0) return null
      const next = heap[0].value
      if (next.availableAt > workerNow) return null

      heap[0] = heap[heap.length - 1]
      heap.pop()
      if (heap.length > 0) siftDown(heap, 0)

      next.leaseUntil = workerNow + options.visibilityMs
      next.attempts += 1
      leased.set(next.id, next)
      byId.set(next.id, next)
      return { job: next, leaseUntil: next.leaseUntil }
    },
    /**
     * Finish a job. This is the only thing that brings a fence down: whatever
     * was waiting on nothing else becomes available at this instant.
     */
    complete(id: string) {
      const job = byId.get(id)
      if (!job) throw new Error(`Unknown job ${id}`)
      byId.delete(id)
      leased.delete(id)
      waiting.delete(id)
      job.leaseUntil = null
      fences.settle(id, 'done')
      release(id)
    },
    /**
     * Hand a job back after a failed attempt.
     *
     * With attempts to spare the job waits out its backoff and the work behind
     * it stays where it is. On the last attempt the job is dead-lettered, and
     * so is everything standing behind it, with the reason naming the job that
     * actually failed.
     */
    fail(id: string, reason: string) {
      const job = byId.get(id)
      if (!job) throw new Error(`Unknown job ${id}`)
      leased.delete(id)
      job.leaseUntil = null
      if (job.attempts >= job.maxAttempts) {
        bury(job, reason)
        collapse(id)
        return { deadLettered: true }
      }
      const wait = delayForAttempt(job.attempts, options.backoff, hash(id))
      job.availableAt = clock.now() + wait
      if (!waiting.has(id)) {
        reheap(job)
      }
      return { deadLettered: false, retryAt: job.availableAt }
    },
    /** Push a lease out without giving the job back. Fences do not move. */
    heartbeat(id: string) {
      const job = byId.get(id)
      if (!job || !job.leaseUntil) {
        throw new Error(`Job ${id} is not leased`)
      }
      job.leaseUntil = clock.now() + options.visibilityMs
      return job.leaseUntil
    },
    /**
     * What the queue would do next, read without touching anything: the jobs a
     * worker could pick up in the order it would get them, the jobs still
     * behind a fence, and the jobs that will never run.
     */
    fencePlan(): FencePlan {
      const now = clock.now()
      recoverExpired(now)

      const ready: string[] = []
      for (const job of rankedOrder()) {
        if (job.availableAt > now) break
        ready.push(job.id)
      }

      const held = [...waiting]
      const isWaiting = (candidate: string) => waiting.has(candidate)
      const plan: FenceWait[] = held.map((id) => ({
        id,
        blockedBy: fences.outstanding(id),
        wave: fences.waveOf(id, isWaiting),
      }))
      plan.sort(
        (a, b) => a.wave - b.wave || (arrival.get(a.id) ?? 0) - (arrival.get(b.id) ?? 0)
      )

      return {
        ready,
        waiting: plan,
        dead: dead.map((entry) => ({ id: entry.job.id, reason: entry.reason })),
      }
    },
    deadLetters() {
      return [...dead]
    },
    size() {
      return byId.size
    },
  }
}

function hash(value: string) {
  let total = 0
  for (let i = 0; i < value.length; i += 1) {
    total = (total * 31 + value.charCodeAt(i)) >>> 0
  }
  return total
}
