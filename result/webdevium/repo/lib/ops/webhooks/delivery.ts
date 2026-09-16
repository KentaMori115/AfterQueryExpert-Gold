import type { Clock } from '@/lib/ops/clock'
import { signPayload, verifySignature } from './sign.js'

export type WebhookAttempt = {
  id: string
  at: number
  ok: boolean
  status: number
}

export type WebhookJob = {
  id: string
  endpoint: string
  payload: string
  signature: string
  attempts: WebhookAttempt[]
  nextAttemptAt: number
  deliveredAt: number | null
}

const RETRY_OFFSETS_MS = [0, 1_000, 5_000, 25_000]

export function createWebhookDispatcher(
  clock: Clock,
  secret: string,
  post: (endpoint: string, body: string, signature: string) => { status: number }
) {
  const jobs = new Map<string, WebhookJob>()

  return {
    enqueue(id: string, endpoint: string, payload: string) {
      const signature = signPayload(secret, payload)
      const job: WebhookJob = {
        id,
        endpoint,
        payload,
        signature,
        attempts: [],
        nextAttemptAt: clock.now(),
        deliveredAt: null,
      }
      jobs.set(id, job)
      return job
    },
    tick() {
      const now = clock.now()
      const due = [...jobs.values()].filter(
        (job) => !job.deliveredAt && job.nextAttemptAt <= now && job.attempts.length < RETRY_OFFSETS_MS.length
      )
      for (const job of due) {
        const result = post(job.endpoint, job.payload, job.signature)
        const ok = result.status >= 200 && result.status < 300
        job.attempts.push({ id: `${job.id}:${job.attempts.length + 1}`, at: now, ok, status: result.status })
        if (ok) {
          job.deliveredAt = now
        } else {
          const next = RETRY_OFFSETS_MS[job.attempts.length]
          job.nextAttemptAt = next === undefined ? Number.POSITIVE_INFINITY : now + next
        }
      }
      return due.map((job) => job.id)
    },
    verifyReplay(payload: string, signature: string, sentAt: number, windowMs: number) {
      const now = clock.now()
      if (Math.abs(now - sentAt) > windowMs) return { ok: false, reason: 'expired' }
      if (!verifySignature(secret, payload, signature)) return { ok: false, reason: 'bad_signature' }
      return { ok: true, reason: 'accepted' }
    },
    get(id: string) {
      return jobs.get(id) ?? null
    },
  }
}
