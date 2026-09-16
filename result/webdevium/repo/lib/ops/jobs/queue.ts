import type { Clock } from '@/lib/ops/clock'
import { delayForAttempt, type BackoffPolicy } from './backoff'
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
}

export type Lease = {
  job: QueuedJob
  leaseUntil: number
}

export type DeadLetter = {
  job: QueuedJob
  reason: string
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

  return {
    enqueue(input: {
      id: string
      name: string
      payload: JobPayload
      priority?: number
      maxAttempts?: number
      idempotencyKey?: string
    }) {
      if (input.idempotencyKey && idempotent.has(input.idempotencyKey)) {
        const existingId = idempotent.get(input.idempotencyKey)!
        return { id: existingId, reused: true }
      }
      if (byId.has(input.id)) {
        throw new Error(`Job ${input.id} already exists`)
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
      byId.set(job.id, job)
      if (job.idempotencyKey) {
        idempotent.set(job.idempotencyKey, job.id)
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
    complete(id: string) {
      const job = byId.get(id)
      if (!job) throw new Error(`Unknown job ${id}`)
      byId.delete(id)
      leased.delete(id)
      job.leaseUntil = null
    },
    fail(id: string, reason: string) {
      const job = byId.get(id)
      if (!job) throw new Error(`Unknown job ${id}`)
      leased.delete(id)
      job.leaseUntil = null
      if (job.attempts >= job.maxAttempts) {
        byId.delete(id)
        dead.push({ job, reason })
        return { deadLettered: true }
      }
      const wait = delayForAttempt(job.attempts, options.backoff, hash(id))
      job.availableAt = clock.now() + wait
      reheap(job)
      return { deadLettered: false, retryAt: job.availableAt }
    },
    heartbeat(id: string) {
      const job = byId.get(id)
      if (!job || !job.leaseUntil) {
        throw new Error(`Job ${id} is not leased`)
      }
      job.leaseUntil = clock.now() + options.visibilityMs
      return job.leaseUntil
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
