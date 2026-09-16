/**
 * The rules that hold for every module, checked on every module.
 *
 * Created stamps, foreign campaign rows, repeated ids and rows a model turns
 * down are all stated without exception, so sampling one or two modules would
 * leave a restore that only honours them for characters looking correct. Each
 * module is driven through the same pair of checks instead.
 *
 * Modules are loaded after this file has been evaluated, so the primitives the
 * comparisons lean on are taken first and rechecked before each one.
 */
import { beforeEach, describe, it } from 'vitest'

const objectIs = Object.is
const isArray = Array.isArray
const objectKeys = Object.keys

type Row = Record<string, unknown>

interface Tally {
  campaignId: string | null
  restored: Record<string, number>
  skipped: Record<string, number>
}

type Lister = { list(): Row[] }

let restoreBundle: (bundle: Row, store: unknown) => Tally
let MemoryStore: new () => unknown
let services: Record<string, new (store: unknown) => Lister>

let loaded = false

beforeEach(async () => {
  if (loaded) return
  restoreBundle = (await import('./restore')).restoreBundle as never
  MemoryStore = (await import('../persistence/storage')).MemoryStore as never
  services = {
    characters: (await import('../services/character-service')).CharacterService as never,
    factions: (await import('../services/faction-service')).FactionService as never,
    locations: (await import('../services/location-service')).LocationService as never,
    sessions: (await import('../services/session-service')).SessionService as never,
    arcs: (await import('../services/arc-service')).ArcService as never,
    encounters: (await import('../services/encounter-service')).EncounterService as never,
    relationships: (await import('../services/relationship-service')).RelationshipService as never,
    lore: (await import('../services/lore-service')).LoreService as never,
    items: (await import('../services/item-service')).ItemService as never,
    quests: (await import('../services/quest-service')).QuestService as never,
    timeline: (await import('../services/timeline-service')).TimelineService as never,
    notes: (await import('../services/note-service')).NoteService as never,
    tags: (await import('../services/tag-service')).TagService as never,
    holidays: (await import('../services/holiday-service')).HolidayService as never,
    downtime: (await import('../services/downtime-service')).DowntimeService as never,
  }
  loaded = true
})

function intact(): void {
  if (Object.is !== objectIs || Array.isArray !== isArray || Object.keys !== objectKeys) {
    throw new Error('the primitives this file compares with were replaced after it loaded')
  }
}

function same(actual: unknown, expected: unknown, message: string): void {
  intact()
  if (!objectIs(actual, expected)) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`)
  }
}

function count(rows: unknown, expected: number, message: string): void {
  const n = isArray(rows) ? rows.length : -1
  same(n, expected, message)
}

const SOURCE = 'camp_SOURCE9'
const OTHER = 'camp_STRANGER'
const MADE = '2024-02-02T00:00:00Z'
const STAMPS = { createdAt: MADE, updatedAt: '2024-02-09T00:00:00Z' }

/** A support character and faction, for the modules that cannot stand alone. */
const SUPPORT_CHARACTER: Row = {
  id: 'char_SUP', campaignId: SOURCE, kind: 'pc', name: 'Wren', pronouns: '', ancestry: '',
  vocation: '', level: 2, disposition: 'unknown', factionId: null, homeId: null, blurb: '',
  alive: true, ...STAMPS,
}

const SUPPORT_FACTION: Row = {
  id: 'fac_SUP', campaignId: SOURCE, name: 'Amber Court', motto: '', description: '',
  alignment: 'mixed', scope: 'regional', influence: 20, leaderId: null, seatId: null,
  active: true, ...STAMPS,
}

interface ModuleCase {
  module: string
  /** A row that should come back. */
  sound: (id: string, campaignId: string) => Row
  /** A row its own model turns down. */
  unsound: (id: string) => Row
  /**
   * A second row carrying an id already used. It differs from the sound row
   * wherever a module has another uniqueness rule of its own, so the repeat is
   * the only thing that can turn it away.
   */
  twin?: (id: string) => Row
  /** A row belonging to another campaign, distinct for the same reason. */
  stranger?: (id: string, campaignId: string) => Row
  /** Rows in other modules this one leans on. */
  support?: Record<string, Row[]>
}

const CASES: ModuleCase[] = [
  {
    module: 'characters',
    sound: (id, campaignId) => ({ ...SUPPORT_CHARACTER, id, campaignId, name: 'Ilse' }),
    unsound: (id) => ({ ...SUPPORT_CHARACTER, id, name: '   ' }),
  },
  {
    module: 'factions',
    sound: (id, campaignId) => ({ ...SUPPORT_FACTION, id, campaignId, name: 'Salt Guild' }),
    unsound: (id) => ({ ...SUPPORT_FACTION, id, influence: 4000 }),
  },
  {
    module: 'locations',
    sound: (id, campaignId) => ({
      id, campaignId, parentId: null, name: 'Coldwater', kind: 'town', shortDescription: '',
      notes: '', visited: false, ...STAMPS,
    }),
    unsound: (id) => ({
      id, campaignId: SOURCE, parentId: null, name: '', kind: 'town', shortDescription: '',
      notes: '', visited: false, ...STAMPS,
    }),
  },
  {
    module: 'sessions',
    sound: (id, campaignId) => ({
      id, campaignId, number: 3, title: 'Under the ice', playedAt: '2024-03-03T00:00:00Z',
      durationMinutes: 180, locationId: null, attendees: [], summary: '', log: '', ...STAMPS,
    }),
    unsound: (id) => ({
      id, campaignId: SOURCE, number: 4, title: 'Broken', playedAt: 'not a date',
      durationMinutes: 180, locationId: null, attendees: [], summary: '', log: '', ...STAMPS,
    }),
  },
  {
    module: 'arcs',
    sound: (id, campaignId) => ({
      id, campaignId, title: 'Ice and salt', synopsis: '', status: 'active', tension: 'rising',
      primaryFactionId: null, rivalFactionId: null, notes: '', ...STAMPS,
    }),
    unsound: (id) => ({
      id, campaignId: SOURCE, title: '', synopsis: '', status: 'active', tension: 'rising',
      primaryFactionId: null, rivalFactionId: null, notes: '', ...STAMPS,
    }),
  },
  {
    module: 'encounters',
    sound: (id, campaignId) => ({
      id, campaignId, sessionId: null, locationId: null, title: 'Ambush', kind: 'combat',
      difficulty: 'hard', summary: '', initiative: [], resolved: false, ...STAMPS,
    }),
    unsound: (id) => ({
      id, campaignId: SOURCE, sessionId: null, locationId: null, title: 'Ambush', kind: 'combat',
      difficulty: 'impossible', summary: '', initiative: [], resolved: false, ...STAMPS,
    }),
  },
  {
    module: 'relationships',
    support: { characters: [SUPPORT_CHARACTER], factions: [SUPPORT_FACTION] },
    sound: (id, campaignId) => ({
      id, campaignId, from: { kind: 'character', id: 'char_SUP' },
      to: { kind: 'faction', id: 'fac_SUP' }, kind: 'ally', intensity: 3, note: '',
      reciprocal: true, ...STAMPS,
    }),
    unsound: (id) => ({
      id, campaignId: SOURCE, from: { kind: 'character', id: 'char_SUP' },
      to: { kind: 'faction', id: 'fac_SUP' }, kind: 'ally', intensity: 90, note: '',
      reciprocal: true, ...STAMPS,
    }),
  },
  {
    module: 'lore',
    sound: (id, campaignId) => ({
      id, campaignId, title: 'The long winter', body: '', category: 'history', tags: [],
      revealed: true, pinned: false, ...STAMPS,
    }),
    unsound: (id) => ({
      id, campaignId: SOURCE, title: '', body: '', category: 'history', tags: [],
      revealed: true, pinned: false, ...STAMPS,
    }),
  },
  {
    module: 'items',
    sound: (id, campaignId) => ({
      id, campaignId, name: 'Amber lens', kind: 'wondrous', rarity: 'rare', magical: true,
      attuned: false, ownerId: null, description: '', valueGp: 120, ...STAMPS,
    }),
    unsound: (id) => ({
      id, campaignId: SOURCE, name: 'Amber lens', kind: 'wondrous', rarity: 'rare',
      magical: true, attuned: false, ownerId: null, description: '', valueGp: -40, ...STAMPS,
    }),
  },
  {
    module: 'quests',
    sound: (id, campaignId) => ({
      id, campaignId, title: 'Find the lens', description: '', status: 'accepted',
      priority: 'high', giverId: null, arcId: null, reward: '', objectives: [], ...STAMPS,
    }),
    unsound: (id) => ({
      id, campaignId: SOURCE, title: 'Find the lens', description: '', status: 'daydreaming',
      priority: 'high', giverId: null, arcId: null, reward: '', objectives: [], ...STAMPS,
    }),
  },
  {
    module: 'timeline',
    sound: (id, campaignId) => ({
      id, campaignId, title: 'Salt war', description: '', date: { year: 812, month: null, day: null },
      era: 'present', significance: 'notable', revealed: true, ...STAMPS,
    }),
    unsound: (id) => ({
      id, campaignId: SOURCE, title: 'Salt war', description: '',
      date: { year: 4_000_000, month: null, day: null }, era: 'present',
      significance: 'notable', revealed: true, ...STAMPS,
    }),
  },
  {
    module: 'notes',
    sound: (id, campaignId) => ({
      id, campaignId, target: { kind: 'campaign', id: SOURCE }, title: '', body: 'table rules',
      priority: 'normal', pinned: false, remindAt: null, resolvedAt: null, ...STAMPS,
    }),
    unsound: (id) => ({
      id, campaignId: SOURCE, target: { kind: 'campaign', id: SOURCE }, title: '', body: '',
      priority: 'normal', pinned: false, remindAt: null, resolvedAt: null, ...STAMPS,
    }),
  },
  {
    module: 'tags',
    sound: (id, campaignId) => ({
      id, campaignId, name: 'Coldwater', slug: 'coldwater', tone: 'moss', description: '',
      appliedTo: [], ...STAMPS,
    }),
    twin: (id) => ({
      id, campaignId: SOURCE, name: 'Saltmarsh', slug: 'saltmarsh', tone: 'moss',
      description: '', appliedTo: [], ...STAMPS,
    }),
    stranger: (id, campaignId) => ({
      id, campaignId, name: 'Marshlight', slug: 'marshlight', tone: 'moss',
      description: '', appliedTo: [], ...STAMPS,
    }),
    unsound: (id) => ({
      id, campaignId: SOURCE, name: '', slug: '', tone: 'moss', description: '',
      appliedTo: [], ...STAMPS,
    }),
  },
  {
    module: 'holidays',
    sound: (id, campaignId) => ({
      id, campaignId, name: 'Thawfeast', month: 3, day: 12, kind: 'civic', observance: '',
      ...STAMPS,
    }),
    unsound: (id) => ({
      id, campaignId: SOURCE, name: 'Thawfeast', month: 99, day: 12, kind: 'civic',
      observance: '', ...STAMPS,
    }),
  },
  {
    module: 'downtime',
    support: { characters: [SUPPORT_CHARACTER] },
    sound: (id, campaignId) => ({
      id, campaignId, characterId: 'char_SUP', kind: 'crafting', outcome: 'planned', weeks: 2,
      description: '', reward: '', ...STAMPS,
    }),
    unsound: (id) => ({
      id, campaignId: SOURCE, characterId: 'char_SUP', kind: 'lounging', outcome: 'planned',
      weeks: 2, description: '', reward: '', ...STAMPS,
    }),
  },
]

function bundleWith(entry: ModuleCase, rows: Row[]): Row {
  const bundle: Row = {
    version: 2,
    campaignId: SOURCE,
    campaign: {
      id: SOURCE, name: 'Ash and Amber', tagline: '', system: 'dnd5e', status: 'active',
      startedAt: null, lastPlayedAt: null, sessionCount: 0,
      createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-05-02T00:00:00Z',
    },
    characters: [], factions: [], locations: [], sessions: [], arcs: [], encounters: [],
    relationships: [], lore: [], items: [], quests: [], timeline: [],
    notes: [], tags: [], holidays: [], downtime: [],
  }
  for (const [module, extra] of Object.entries(entry.support ?? {})) {
    bundle[module] = extra
  }
  bundle[entry.module] = rows
  return bundle
}

function rowsFor(store: unknown, entry: ModuleCase, campaignId: string): Row[] {
  const Service = services[entry.module]!
  return new Service(store).list().filter((row) => row.campaignId === campaignId)
}

describe('restoreBundle across every module', () => {
  let store: unknown

  beforeEach(() => {
    store = new MemoryStore()
  })

  for (const entry of CASES) {
    it(`${entry.module} keep the stamp they arrived with and take a fresh one`, () => {
      const startedAt = Date.now()
      const result = restoreBundle(bundleWith(entry, [entry.sound('row_A', SOURCE)]), store)
      const rows = rowsFor(store, entry, String(result.campaignId))
      count(rows, 1, `one ${entry.module} row is written`)
      same(rows[0]!.createdAt, MADE, `the ${entry.module} row keeps the stamp it arrived with`)
      const updated = Date.parse(String(rows[0]!.updatedAt))
      same(updated >= startedAt - 1000, true, `the ${entry.module} row is stamped as updated now`)
      same(result.restored[entry.module], 1, `one ${entry.module} row is counted as restored`)
    })

    it(`${entry.module} turn away a stranger, a repeat and a row the model rejects`, () => {
      const rows = [
        entry.sound('row_A', SOURCE),
        (entry.stranger ?? entry.sound)('row_B', OTHER),
        (entry.twin ?? entry.sound)('row_A', SOURCE),
        entry.unsound('row_C'),
      ]
      const result = restoreBundle(bundleWith(entry, rows), store)
      const written = rowsFor(store, entry, String(result.campaignId))
      count(written, 1, `only the sound ${entry.module} row is written`)
      same(result.restored[entry.module], 1, `one ${entry.module} row is counted as restored`)
      same(result.skipped[entry.module], 3, `the other three ${entry.module} rows are counted as skipped`)
    })
  }
})
