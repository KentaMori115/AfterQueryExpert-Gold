import { beforeEach, describe, expect, it } from 'vitest'

import { EntityRepo } from './entity-repo'
import { MemoryStore } from './storage'

interface Thing {
  id: string
  name: string
}

describe('EntityRepo', () => {
  let store: MemoryStore
  let repo: EntityRepo<string, Thing>

  beforeEach(() => {
    store = new MemoryStore()
    repo = new EntityRepo<string, Thing>(store, 'things')
  })

  it('starts empty', () => {
    expect(repo.list()).toEqual([])
    expect(repo.count()).toBe(0)
  })

  it('puts and gets entities', () => {
    repo.put({ id: 'a', name: 'A' })
    repo.put({ id: 'b', name: 'B' })
    expect(repo.get('a')).toEqual({ id: 'a', name: 'A' })
    expect(repo.has('b')).toBe(true)
    expect(repo.count()).toBe(2)
  })

  it('returns null for unknown ids', () => {
    expect(repo.get('missing')).toBe(null)
    expect(repo.has('missing')).toBe(false)
  })

  it('overwrites on put with the same id', () => {
    repo.put({ id: 'a', name: 'first' })
    repo.put({ id: 'a', name: 'second' })
    expect(repo.get('a')?.name).toBe('second')
    expect(repo.count()).toBe(1)
  })

  it('removes entities and reports existed', () => {
    repo.put({ id: 'a', name: 'A' })
    expect(repo.remove('a')).toBe(true)
    expect(repo.remove('a')).toBe(false)
    expect(repo.get('a')).toBe(null)
  })

  it('clears the whole collection', () => {
    repo.putMany([
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ])
    repo.clear()
    expect(repo.list()).toEqual([])
  })

  it('persists to the backing store across reload', () => {
    repo.put({ id: 'a', name: 'A' })
    repo.put({ id: 'b', name: 'B' })
    const fresh = new EntityRepo<string, Thing>(store, 'things')
    expect(fresh.list().map((t) => t.id).sort()).toEqual(['a', 'b'])
  })

  it('tolerates corrupt stored data without crashing', () => {
    store.set('things', '{not-valid-json')
    const fresh = new EntityRepo<string, Thing>(store, 'things')
    expect(fresh.list()).toEqual([])
  })

  it('reload drops the cache so a fresh read happens next call', () => {
    repo.put({ id: 'a', name: 'A' })
    store.set('things', JSON.stringify([{ id: 'a', name: 'changed' }, { id: 'b', name: 'B' }]))
    repo.reload()
    expect(repo.get('a')?.name).toBe('changed')
    expect(repo.has('b')).toBe(true)
  })
})
