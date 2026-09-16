import type { KeyValueStore } from './storage'

export interface EntityWithId<Id extends string> {
  id: Id
}

/**
 * Generic CRUD-on-top-of-KV repo. Each repo owns a single key in the underlying
 * store and serialises the whole collection as JSON. Fine for the size of data
 * a single GM accumulates over a campaign; we trade write efficiency for
 * radically simpler reads and zero migration cost.
 */
export class EntityRepo<Id extends string, T extends EntityWithId<Id>> {
  private cache: Map<Id, T> | null = null

  constructor(
    private readonly store: KeyValueStore,
    private readonly key: string,
  ) {}

  list(): T[] {
    return Array.from(this.ensure().values())
  }

  get(id: Id): T | null {
    return this.ensure().get(id) ?? null
  }

  has(id: Id): boolean {
    return this.ensure().has(id)
  }

  put(entity: T): T {
    const map = this.ensure()
    map.set(entity.id, entity)
    this.persist(map)
    return entity
  }

  putMany(entities: ReadonlyArray<T>): void {
    const map = this.ensure()
    for (const e of entities) map.set(e.id, e)
    this.persist(map)
  }

  remove(id: Id): boolean {
    const map = this.ensure()
    const existed = map.delete(id)
    if (existed) this.persist(map)
    return existed
  }

  clear(): void {
    this.cache = new Map()
    this.persist(this.cache)
  }

  count(): number {
    return this.ensure().size
  }

  reload(): void {
    this.cache = null
  }

  private ensure(): Map<Id, T> {
    if (this.cache) return this.cache
    this.cache = new Map()
    const raw = this.store.get(this.key)
    if (!raw) return this.cache
    try {
      // TODO: validate the parsed payload against a per-entity schema once we move
      // off localStorage. Trusting JSON.parse here is fine for the local-first
      // case but bites the moment we start syncing across devices.
      const parsed = JSON.parse(raw) as T[]
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item === 'object' && 'id' in item) {
            this.cache.set(item.id as Id, item)
          }
        }
      }
    } catch (err) {
      console.warn(`failed to parse repo data for ${this.key}`, err)
    }
    return this.cache
  }

  private persist(map: Map<Id, T>): void {
    const arr = Array.from(map.values())
    this.store.set(this.key, JSON.stringify(arr))
  }
}
