export type Versioned<T> = {
  value: T
  version: number
  etag: string
}

export class PreconditionFailedError extends Error {
  constructor(public readonly actual: string, public readonly expected: string) {
    super(`If-Match ${expected} does not match ${actual}`)
    this.name = 'PreconditionFailedError'
  }
}

export function makeEtag(id: string, version: number) {
  return `W/"${id}:${version}"`
}

export function parseIfMatch(header: string | undefined) {
  if (!header || header === '*') return header ?? null
  return header.trim()
}

export function createVersionStore<T>() {
  const items = new Map<string, Versioned<T>>()

  return {
    get(id: string) {
      return items.get(id) ?? null
    },
    put(id: string, value: T, ifMatch?: string): Versioned<T> {
      const current = items.get(id)
      if (!current) {
        if (ifMatch && ifMatch !== '*') {
          throw new PreconditionFailedError('missing', ifMatch)
        }
        const created = { value, version: 1, etag: makeEtag(id, 1) }
        items.set(id, created)
        return created
      }
      const expected = parseIfMatch(ifMatch ?? undefined)
      if (expected && expected !== '*' && expected !== current.etag) {
        throw new PreconditionFailedError(current.etag, expected)
      }
      const version = current.version + 1
      const next = { value, version, etag: makeEtag(id, version) }
      items.set(id, next)
      return next
    },
    patch(id: string, ifMatch: string, mutate: (current: T) => T) {
      const current = items.get(id)
      if (!current) {
        throw new PreconditionFailedError('missing', ifMatch)
      }
      if (ifMatch !== current.etag) {
        throw new PreconditionFailedError(current.etag, ifMatch)
      }
      return this.put(id, mutate(current.value), current.etag)
    },
  }
}
