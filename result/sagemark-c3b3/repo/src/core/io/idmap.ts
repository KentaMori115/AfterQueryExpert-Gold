import type { BundleModule } from './bundle'

/**
 * What a reference in a bundle can point at: one of the modules, or the
 * campaign the bundle was taken from.
 */
export type RefKind = BundleModule | 'campaign'

/**
 * Old id to new id, kept per kind so an id that appears in two modules cannot
 * be confused for the other one. The map is filled before anything is written,
 * so a reference pointing forward, or back around a cycle, resolves the same
 * way as one pointing at a row that was already handled.
 */
export class IdMap {
  private readonly byKind = new Map<RefKind, Map<string, string>>()

  mint(kind: RefKind, oldId: string, newId: string): void {
    let bucket = this.byKind.get(kind)
    if (!bucket) {
      bucket = new Map<string, string>()
      this.byKind.set(kind, bucket)
    }
    bucket.set(oldId, newId)
  }

  lookup(kind: RefKind, oldId: unknown): string | null {
    if (typeof oldId !== 'string' || oldId.length === 0) return null
    return this.byKind.get(kind)?.get(oldId) ?? null
  }

  has(kind: RefKind, oldId: unknown): boolean {
    return this.lookup(kind, oldId) !== null
  }

  /** Resolve every id in a list, dropping the ones the bundle never carried. */
  lookupAll(kind: RefKind, oldIds: unknown): string[] {
    if (!Array.isArray(oldIds)) return []
    const out: string[] = []
    for (const old of oldIds) {
      const next = this.lookup(kind, old)
      if (next !== null && !out.includes(next)) out.push(next)
    }
    return out
  }

  size(kind: RefKind): number {
    return this.byKind.get(kind)?.size ?? 0
  }
}
