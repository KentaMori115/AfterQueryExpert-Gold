export interface KeyValueStore {
  get(key: string): string | null
  set(key: string, value: string): void
  remove(key: string): void
  keys(): string[]
  clear(): void
}

export class MemoryStore implements KeyValueStore {
  private readonly map = new Map<string, string>()

  get(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null
  }

  set(key: string, value: string): void {
    this.map.set(key, value)
  }

  remove(key: string): void {
    this.map.delete(key)
  }

  keys(): string[] {
    return Array.from(this.map.keys())
  }

  clear(): void {
    this.map.clear()
  }

  size(): number {
    return this.map.size
  }
}

export class LocalStorageStore implements KeyValueStore {
  private readonly prefix: string

  constructor(prefix = 'sagemark:') {
    this.prefix = prefix
  }

  private full(key: string): string {
    return this.prefix + key
  }

  get(key: string): string | null {
    try {
      return window.localStorage.getItem(this.full(key))
    } catch {
      return null
    }
  }

  set(key: string, value: string): void {
    try {
      window.localStorage.setItem(this.full(key), value)
    } catch (err) {
      console.warn('localStorage set failed', err)
    }
  }

  remove(key: string): void {
    try {
      window.localStorage.removeItem(this.full(key))
    } catch {
      // ignore
    }
  }

  keys(): string[] {
    try {
      const out: string[] = []
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i)
        if (k && k.startsWith(this.prefix)) out.push(k.slice(this.prefix.length))
      }
      return out
    } catch {
      return []
    }
  }

  clear(): void {
    for (const k of this.keys()) this.remove(k)
  }
}

let defaultStore: KeyValueStore | null = null

export function getStore(): KeyValueStore {
  if (defaultStore) return defaultStore
  if (typeof window !== 'undefined' && window.localStorage) {
    defaultStore = new LocalStorageStore()
  } else {
    defaultStore = new MemoryStore()
  }
  return defaultStore
}

export function setStore(store: KeyValueStore | null): void {
  defaultStore = store
}
