/**
 * The shape a campaign export carries and the vocabulary the restore engine
 * uses to talk about it. `buildExport` in the io feature writes bundles in this
 * shape; nothing here imports a store or a component, so the engine stays
 * usable from a plain script or a test.
 */

export const BUNDLE_MODULES = [
  'characters',
  'factions',
  'locations',
  'sessions',
  'arcs',
  'encounters',
  'relationships',
  'lore',
  'items',
  'quests',
  'timeline',
  'notes',
  'tags',
  'holidays',
  'downtime',
] as const

export type BundleModule = (typeof BUNDLE_MODULES)[number]

/** Modules a version 1 bundle never carries. */
export const V2_MODULES: ReadonlyArray<BundleModule> = ['notes', 'tags', 'holidays', 'downtime']

export interface CampaignBundle {
  version: number
  exportedAt?: string
  campaignId: string
  campaign: unknown
  characters: unknown[]
  factions: unknown[]
  locations: unknown[]
  sessions: unknown[]
  arcs: unknown[]
  encounters: unknown[]
  relationships: unknown[]
  lore: unknown[]
  items: unknown[]
  quests: unknown[]
  timeline: unknown[]
  notes?: unknown[]
  tags?: unknown[]
  holidays?: unknown[]
  downtime?: unknown[]
  treasury?: unknown
}

export type ModuleTally = Record<BundleModule, number>

export function emptyTally(): ModuleTally {
  const out = {} as ModuleTally
  for (const m of BUNDLE_MODULES) out[m] = 0
  return out
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Rows a bundle carries for one module. A module the bundle leaves out reads
 * as empty rather than as an error, which is what makes a version 1 bundle
 * restorable without a special case per module.
 */
export function moduleRows(bundle: CampaignBundle, module: BundleModule): unknown[] {
  const raw = (bundle as unknown as Record<string, unknown>)[module]
  return Array.isArray(raw) ? raw : []
}

export function rowId(row: unknown): string | null {
  if (!isRecord(row)) return null
  const id = row.id
  return typeof id === 'string' && id.length > 0 ? id : null
}
