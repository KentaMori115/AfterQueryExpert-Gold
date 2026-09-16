import { describe, expect, it } from 'vitest'
import { projectTask, replayFromSnapshot } from './project'
import { ConcurrencyError, createEventStore } from './stream'

describe('event store + task projection', () => {
  it('appends with optimistic stream versions and projects current state', () => {
    const store = createEventStore()
    store.append('task-1', 0, [
      { type: 'task.created', at: 1, payload: { id: 'task-1', title: 'Homepage' } },
    ])
    store.append('task-1', 1, [
      { type: 'task.started', at: 2, payload: {} },
      { type: 'task.hours_logged', at: 3, payload: { hours: 1.5 } },
    ])

    const projected = projectTask(store.load('task-1'))
    expect(projected).toEqual({
      id: 'task-1',
      title: 'Homepage',
      status: 'in_progress',
      hours: 1.5,
      version: 3,
    })
  })

  it('rejects a stale append and can resume from a snapshot', () => {
    const store = createEventStore()
    store.append('task-1', 0, [
      { type: 'task.created', at: 1, payload: { id: 'task-1', title: 'A' } },
    ])
    expect(() =>
      store.append('task-1', 0, [{ type: 'task.renamed', at: 2, payload: { title: 'B' } }])
    ).toThrow(ConcurrencyError)

    store.snapshot('task-1', 1, {
      id: 'task-1',
      title: 'A',
      status: 'queued',
      hours: 0,
      version: 1,
    })
    store.append('task-1', 1, [
      { type: 'task.completed', at: 4, payload: {} },
    ])
    const restored = replayFromSnapshot(store.loadSnapshot('task-1') as never, store.load('task-1'))
    expect(restored?.status).toBe('done')
    expect(restored?.version).toBe(2)
  })
})
