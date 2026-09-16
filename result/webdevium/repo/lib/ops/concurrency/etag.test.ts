import { describe, expect, it } from 'vitest'
import { createVersionStore, makeEtag, PreconditionFailedError } from './etag'

describe('createVersionStore', () => {
  it('creates an etag and rejects a stale If-Match on write', () => {
    const store = createVersionStore<{ title: string }>()
    const created = store.put('task-1', { title: 'A' })
    expect(created.etag).toBe(makeEtag('task-1', 1))

    const updated = store.put('task-1', { title: 'B' }, created.etag)
    expect(updated.version).toBe(2)
    expect(() => store.put('task-1', { title: 'C' }, created.etag)).toThrow(PreconditionFailedError)
  })

  it('applies a conditional patch only when the caller still holds the latest etag', () => {
    const store = createVersionStore<{ hours: number }>()
    const created = store.put('t', { hours: 1 })
    const patched = store.patch('t', created.etag, (value) => ({ hours: value.hours + 2 }))
    expect(patched.value.hours).toBe(3)
    expect(() => store.patch('t', created.etag, (value) => value)).toThrow(PreconditionFailedError)
  })
})
