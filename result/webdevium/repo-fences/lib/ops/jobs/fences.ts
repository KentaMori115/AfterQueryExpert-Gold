export type FenceOutcome = 'done' | 'dead'

export type FenceWait = {
  id: string
  blockedBy: string[]
  wave: number
}

/**
 * A job was enqueued behind an id the queue has never seen.
 *
 * Almost always a typo or a race in the code doing the enqueuing. Holding the
 * job instead would park it forever behind a fence that nothing can bring
 * down, so the enqueue is refused and the caller hears about it.
 */
export class UnknownFenceError extends Error {
  constructor(jobId: string, fenceId: string) {
    super(`Job ${jobId} cannot wait on unknown job ${fenceId}`)
    this.name = 'UnknownFenceError'
  }
}

/**
 * The book of what waits on what.
 *
 * A fence is one job id another job was enqueued behind. The book keeps the
 * ids in the order the caller listed them, the jobs standing behind each id in
 * the order they arrived, and the outcome of everything that has settled. It
 * holds no job records of its own: the queue owns those, and passes in what it
 * still holds when the answer depends on it.
 */
export function createFenceBook() {
  const required = new Map<string, string[]>()
  const dependents = new Map<string, string[]>()
  const outcomes = new Map<string, FenceOutcome>()

  const behind = (fenceId: string) => {
    const existing = dependents.get(fenceId)
    if (existing) return existing
    const created: string[] = []
    dependents.set(fenceId, created)
    return created
  }

  return {
    /** Every id this job was enqueued behind, in the order it was listed. */
    fencesOf(jobId: string) {
      return [...(required.get(jobId) ?? [])]
    },

    /** True once the queue has seen this id, whether it is live or settled. */
    settled(fenceId: string) {
      return outcomes.has(fenceId)
    },

    outcomeOf(fenceId: string) {
      return outcomes.get(fenceId) ?? null
    },

    /** Write down what a new job waits on. */
    record(jobId: string, fences: string[]) {
      if (fences.length === 0) return
      required.set(jobId, [...fences])
      for (const fenceId of fences) {
        const line = behind(fenceId)
        if (!line.includes(jobId)) {
          line.push(jobId)
        }
      }
    },

    /** The fences of this job that have not been completed yet. */
    outstanding(jobId: string) {
      return (required.get(jobId) ?? []).filter((fenceId) => outcomes.get(fenceId) !== 'done')
    },

    /**
     * The first fence of this job that can never clear, or null when the job
     * still has a way through.
     */
    brokenBy(jobId: string) {
      for (const fenceId of required.get(jobId) ?? []) {
        if (outcomes.get(fenceId) === 'dead') return fenceId
      }
      return null
    },

    /** Record how a job finished, so the jobs behind it can be answered. */
    settle(jobId: string, outcome: FenceOutcome) {
      outcomes.set(jobId, outcome)
    },

    /**
     * The jobs standing behind this one whose last fence just came down, in
     * the order they were enqueued.
     */
    releasedBy(fenceId: string) {
      return (dependents.get(fenceId) ?? []).filter(
        (jobId) => this.outstanding(jobId).length === 0
      )
    },

    /**
     * Everything standing behind this job, directly or at a remove, walked one
     * rank at a time and inside a rank in the order the jobs were enqueued.
     * The job itself is not part of the answer.
     */
    cascadeFrom(fenceId: string) {
      const order: string[] = []
      const seen = new Set<string>([fenceId])
      let frontier = [...(dependents.get(fenceId) ?? [])]
      while (frontier.length > 0) {
        const next: string[] = []
        for (const jobId of frontier) {
          if (seen.has(jobId)) continue
          seen.add(jobId)
          order.push(jobId)
          next.push(...(dependents.get(jobId) ?? []))
        }
        frontier = next
      }
      return order
    },

    /**
     * How many rounds of waiting stand between this job and the queue: one
     * when everything it waits on is already in the queue's hands, one more
     * for every job in front of it that is itself still waiting.
     */
    waveOf(jobId: string, isWaiting: (candidate: string) => boolean) {
      const depth = (candidate: string, path: Set<string>): number => {
        if (path.has(candidate)) return 0
        path.add(candidate)
        let deepest = 0
        for (const fenceId of this.outstanding(candidate)) {
          if (!isWaiting(fenceId)) continue
          deepest = Math.max(deepest, depth(fenceId, path))
        }
        path.delete(candidate)
        return deepest + 1
      }
      return depth(jobId, new Set<string>())
    },

    /** Forget a job that will never run, so nothing waits on it twice. */
    drop(jobId: string) {
      required.delete(jobId)
    },
  }
}

export type FenceBook = ReturnType<typeof createFenceBook>
