export type DomainEvent<T = Record<string, unknown>> = {
  streamId: string
  type: string
  at: number
  version: number
  payload: T
}

export class ConcurrencyError extends Error {
  constructor(public readonly expected: number, public readonly actual: number) {
    super(`Expected stream version ${expected} but was ${actual}`)
    this.name = 'ConcurrencyError'
  }
}

export function createEventStore() {
  const streams = new Map<string, DomainEvent[]>()
  const snapshots = new Map<string, { version: number; state: unknown }>()

  return {
    append<T>(
      streamId: string,
      expectedVersion: number,
      events: Omit<DomainEvent<T>, 'streamId' | 'version'>[]
    ) {
      const current = streams.get(streamId) ?? []
      const actual = current.length
      if (actual !== expectedVersion) {
        throw new ConcurrencyError(expectedVersion, actual)
      }
      const appended = events.map((event, index) => ({
        ...event,
        streamId,
        version: actual + index + 1,
      }))
      streams.set(streamId, [...current, ...appended])
      return appended
    },
    load(streamId: string, afterVersion = 0) {
      return (streams.get(streamId) ?? []).filter((event) => event.version > afterVersion)
    },
    snapshot(streamId: string, version: number, state: unknown) {
      snapshots.set(streamId, { version, state })
    },
    loadSnapshot(streamId: string) {
      return snapshots.get(streamId) ?? null
    },
  }
}
