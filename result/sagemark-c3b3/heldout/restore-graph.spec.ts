/**
 * Restoring a bundle: what comes back, and what it points at.
 *
 * Everything under test is loaded after this module body has run, so the few
 * primitives these checks lean on are taken first and the assertions below are
 * plain comparisons rather than matchers.
 */
import { beforeEach, describe, it } from 'vitest'

const objectIs = Object.is
const isArray = Array.isArray
const objectKeys = Object.keys

type Row = Record<string, unknown>

let restoreBundle: (bundle: Row, store: unknown) => Row
let MemoryStore: new () => unknown
let CampaignService: new (store: unknown) => { list(): Row[]; get(id: string): Row }
let CharacterService: new (store: unknown) => { list(): Row[] }
let FactionService: new (store: unknown) => { list(): Row[] }
let LocationService: new (store: unknown) => { list(): Row[] }
let SessionService: new (store: unknown) => { list(): Row[] }
let ArcService: new (store: unknown) => { list(): Row[] }
let EncounterService: new (store: unknown) => { list(): Row[] }
let RelationshipService: new (store: unknown) => { list(): Row[] }
let ItemService: new (store: unknown) => { list(): Row[] }
let QuestService: new (store: unknown) => { list(): Row[] }
let NoteService: new (store: unknown) => { list(): Row[] }
let TagService: new (store: unknown) => { list(): Row[] }

let loaded = false

beforeEach(async () => {
  if (loaded) return
  const io = await import('./restore')
  restoreBundle = io.restoreBundle as never
  MemoryStore = (await import('../persistence/storage')).MemoryStore as never
  CampaignService = (await import('../services/campaign-service')).CampaignService as never
  CharacterService = (await import('../services/character-service')).CharacterService as never
  FactionService = (await import('../services/faction-service')).FactionService as never
  LocationService = (await import('../services/location-service')).LocationService as never
  SessionService = (await import('../services/session-service')).SessionService as never
  ArcService = (await import('../services/arc-service')).ArcService as never
  EncounterService = (await import('../services/encounter-service')).EncounterService as never
  RelationshipService = (await import('../services/relationship-service')).RelationshipService as never
  ItemService = (await import('../services/item-service')).ItemService as never
  QuestService = (await import('../services/quest-service')).QuestService as never
  NoteService = (await import('../services/note-service')).NoteService as never
  TagService = (await import('../services/tag-service')).TagService as never
  loaded = true
})

function intact(): void {
  if (Object.is !== objectIs || Array.isArray !== isArray || Object.keys !== objectKeys) {
    throw new Error('the primitives this file compares with were replaced after it loaded')
  }
}

function ok(condition: boolean, message: string): void {
  intact()
  if (condition !== true) throw new Error(message)
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

const SOURCE = 'camp_SOURCE1'
const STAMPS = { createdAt: '2024-02-02T00:00:00Z', updatedAt: '2024-02-09T00:00:00Z' }

function emptyBundle(over: Row = {}): Row {
  return {
    version: 2,
    exportedAt: '2024-06-01T00:00:00Z',
    campaignId: SOURCE,
    campaign: {
      id: SOURCE,
      name: 'Ash and Amber',
      tagline: 'a road book',
      system: 'dnd5e',
      status: 'active',
      startedAt: '2024-01-02T00:00:00Z',
      lastPlayedAt: '2024-05-02T00:00:00Z',
      sessionCount: 9,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-05-02T00:00:00Z',
    },
    characters: [],
    factions: [],
    locations: [],
    sessions: [],
    arcs: [],
    encounters: [],
    relationships: [],
    lore: [],
    items: [],
    quests: [],
    timeline: [],
    notes: [],
    tags: [],
    holidays: [],
    downtime: [],
    ...over,
  }
}

function character(id: string, name: string, over: Row = {}): Row {
  return {
    id,
    campaignId: SOURCE,
    kind: 'pc', name, pronouns: 'they/them', ancestry: 'human', vocation: 'ranger',
    level: 4, disposition: 'allied', factionId: null, homeId: null, blurb: '', alive: true,
    ...STAMPS,
    ...over,
  }
}

function faction(id: string, name: string, over: Row = {}): Row {
  return {
    id,
    campaignId: SOURCE,
    name, motto: '', description: '', alignment: 'mixed', scope: 'regional',
    influence: 40, leaderId: null, seatId: null, active: true,
    ...STAMPS,
    ...over,
  }
}

function place(id: string, name: string, over: Row = {}): Row {
  return {
    id,
    campaignId: SOURCE,
    parentId: null, name, kind: 'town', shortDescription: '', notes: '', visited: true,
    ...STAMPS,
    ...over,
  }
}

function session(id: string, number: number, title: string, over: Row = {}): Row {
  return {
    id,
    campaignId: SOURCE,
    number, title, playedAt: '2024-03-03T00:00:00Z', durationMinutes: 210,
    locationId: null, attendees: [], summary: '', log: '',
    ...STAMPS,
    ...over,
  }
}

function arc(id: string, title: string, over: Row = {}): Row {
  return {
    id,
    campaignId: SOURCE,
    title, synopsis: '', status: 'active', tension: 'rising',
    primaryFactionId: null, rivalFactionId: null, notes: '',
    ...STAMPS,
    ...over,
  }
}

function encounter(id: string, title: string, over: Row = {}): Row {
  return {
    id,
    campaignId: SOURCE,
    sessionId: null, locationId: null, title, kind: 'combat', difficulty: 'hard',
    summary: '', initiative: [], resolved: false,
    ...STAMPS,
    ...over,
  }
}

function quest(id: string, title: string, over: Row = {}): Row {
  return {
    id,
    campaignId: SOURCE,
    title, description: '', status: 'accepted', priority: 'high',
    giverId: null, arcId: null, reward: '', objectives: [],
    ...STAMPS,
    ...over,
  }
}

function item(id: string, name: string, over: Row = {}): Row {
  return {
    id,
    campaignId: SOURCE,
    name, kind: 'wondrous', rarity: 'rare', magical: true, attuned: false,
    ownerId: null, description: '', valueGp: 250,
    ...STAMPS,
    ...over,
  }
}

function note(id: string, body: string, target: Row, over: Row = {}): Row {
  return {
    id,
    campaignId: SOURCE,
    target, title: '', body, priority: 'normal', pinned: false,
    remindAt: null, resolvedAt: null,
    ...STAMPS,
    ...over,
  }
}

function tag(id: string, name: string, appliedTo: Row[], over: Row = {}): Row {
  return {
    id,
    campaignId: SOURCE,
    name, slug: name.toLowerCase(), tone: 'crimson', description: '', appliedTo,
    ...STAMPS,
    ...over,
  }
}

function relation(id: string, from: Row, to: Row, over: Row = {}): Row {
  return {
    id,
    campaignId: SOURCE,
    from, to, kind: 'rival', intensity: 4, note: '', reciprocal: true,
    ...STAMPS,
    ...over,
  }
}

function named(rows: Row[], key: string, value: string): Row {
  const found = rows.find((row) => row[key] === value)
  if (!found) throw new Error(`no restored row with ${key} "${value}"`)
  return found
}

describe('restoreBundle identity', () => {
  let store: unknown

  beforeEach(() => {
    store = new MemoryStore()
  })

  it('reports the campaign it wrote, under an id of its own', () => {
    const result = restoreBundle(emptyBundle(), store)
    const campaigns = new CampaignService(store).list()
    count(campaigns, 1, 'one campaign restored')
    same(result.campaignId, campaigns[0]!.id, 'result names the campaign it wrote')
    ok(typeof result.campaignId === 'string', 'campaign id is a string')
    ok(result.campaignId !== SOURCE, 'campaign id is not the one the bundle carried')
    same(campaigns[0]!.name, 'Ash and Amber', 'campaign name survives')
  })

  it('hands every row an id the bundle never used', () => {
    const bundle = emptyBundle({
      characters: [character('char_SRC', 'Wren')],
      items: [item('itm_SRC', 'Amber lens')],
      lore: [
        {
          id: 'lor_SRC',
          campaignId: SOURCE,
          title: 'The long winter',
          body: '',
          category: 'history',
          tags: [],
          revealed: true,
          pinned: false,
          ...STAMPS,
        },
      ],
    })
    restoreBundle(bundle, store)
    const wren = new CharacterService(store).list()[0]!
    const lens = new ItemService(store).list()[0]!
    ok(wren.id !== 'char_SRC', 'character id is fresh')
    ok(lens.id !== 'itm_SRC', 'item id is fresh')
    same(wren.name, 'Wren', 'character name survives')
    same(lens.name, 'Amber lens', 'item name survives')
  })

  it('leaves rows that were already stored alone and lands twice on a second run', () => {
    const bundle = emptyBundle({ characters: [character('char_SRC', 'Wren')] })
    const first = restoreBundle(bundle, store)
    const firstCharacter = new CharacterService(store).list()[0]!
    const second = restoreBundle(bundle, store)

    ok(first.campaignId !== second.campaignId, 'second restore is a campaign of its own')
    count(new CampaignService(store).list(), 2, 'both campaigns are stored')
    const characters = new CharacterService(store).list()
    count(characters, 2, 'both copies of the character are stored')
    const survivor = named(characters, 'id', String(firstCharacter.id))
    same(survivor.campaignId, first.campaignId, 'the first copy still belongs to the first campaign')
  })

  it('keeps the created stamp a row arrived with and stamps the update now', () => {
    const before = Date.now()
    restoreBundle(emptyBundle({ characters: [character('char_SRC', 'Wren')] }), store)
    const wren = new CharacterService(store).list()[0]!
    same(wren.createdAt, '2024-02-02T00:00:00Z', 'created stamp travels with the row')
    const updated = Date.parse(String(wren.updatedAt))
    ok(updated >= before - 1000, 'updated stamp is from this restore')
  })

  it('keeps the campaign start and last played stamps', () => {
    const result = restoreBundle(emptyBundle(), store)
    const campaign = new CampaignService(store).get(String(result.campaignId))
    same(campaign.startedAt, '2024-01-02T00:00:00Z', 'started stamp survives')
    same(campaign.lastPlayedAt, '2024-05-02T00:00:00Z', 'last played stamp survives')
    same(campaign.createdAt, '2024-01-01T00:00:00Z', 'campaign created stamp survives')
  })
})

describe('restoreBundle references', () => {
  let store: unknown

  beforeEach(() => {
    store = new MemoryStore()
  })

  it('rewrites a character to the faction and the home that came back with it', () => {
    const bundle = emptyBundle({
      characters: [character('char_SRC', 'Wren', { factionId: 'fac_SRC', homeId: 'loc_SRC' })],
      factions: [faction('fac_SRC', 'Amber Court')],
      locations: [place('loc_SRC', 'Coldwater')],
    })
    restoreBundle(bundle, store)
    const wren = new CharacterService(store).list()[0]!
    const court = new FactionService(store).list()[0]!
    const coldwater = new LocationService(store).list()[0]!
    same(wren.factionId, court.id, 'faction reference follows the restored faction')
    same(wren.homeId, coldwater.id, 'home reference follows the restored location')
  })

  it('resolves a pair that point at each other', () => {
    const bundle = emptyBundle({
      characters: [character('char_SRC', 'Wren', { factionId: 'fac_SRC' })],
      factions: [faction('fac_SRC', 'Amber Court', { leaderId: 'char_SRC' })],
    })
    restoreBundle(bundle, store)
    const wren = new CharacterService(store).list()[0]!
    const court = new FactionService(store).list()[0]!
    same(wren.factionId, court.id, 'character points at the restored faction')
    same(court.leaderId, wren.id, 'faction points back at the restored character')
  })

  it('resolves a parent that appears further down its own list', () => {
    const bundle = emptyBundle({
      locations: [place('loc_CHILD', 'Dockside', { parentId: 'loc_PARENT' }), place('loc_PARENT', 'Coldwater')],
    })
    restoreBundle(bundle, store)
    const places = new LocationService(store).list()
    const child = named(places, 'name', 'Dockside')
    const parent = named(places, 'name', 'Coldwater')
    same(child.parentId, parent.id, 'child points at the restored parent')
    same(parent.parentId, null, 'the parent itself has no parent')
  })

  it('rewrites a faction seat and a session place', () => {
    const bundle = emptyBundle({
      factions: [faction('fac_SRC', 'Amber Court', { seatId: 'loc_SRC' })],
      locations: [place('loc_SRC', 'Coldwater')],
      sessions: [session('ses_SRC', 4, 'Under the ice', { locationId: 'loc_SRC' })],
    })
    restoreBundle(bundle, store)
    const coldwater = new LocationService(store).list()[0]!
    same(new FactionService(store).list()[0]!.seatId, coldwater.id, 'seat follows the location')
    same(new SessionService(store).list()[0]!.locationId, coldwater.id, 'session place follows the location')
  })

  it('rewrites the attendee list of a session', () => {
    const bundle = emptyBundle({
      characters: [character('char_A', 'Wren'), character('char_B', 'Ilse')],
      sessions: [session('ses_SRC', 4, 'Under the ice', { attendees: ['char_A', 'char_B'] })],
    })
    restoreBundle(bundle, store)
    const characters = new CharacterService(store).list()
    const attendees = new SessionService(store).list()[0]!.attendees as string[]
    count(attendees, 2, 'both attendees survive')
    ok(attendees.includes(String(named(characters, 'name', 'Wren').id)), 'Wren is on the list')
    ok(attendees.includes(String(named(characters, 'name', 'Ilse').id)), 'Ilse is on the list')
  })

  it('rewrites both faction slots on an arc', () => {
    const bundle = emptyBundle({
      factions: [faction('fac_A', 'Amber Court'), faction('fac_B', 'Salt Guild')],
      arcs: [arc('arc_SRC', 'Ice and salt', { primaryFactionId: 'fac_A', rivalFactionId: 'fac_B' })],
    })
    restoreBundle(bundle, store)
    const factions = new FactionService(store).list()
    const restoredArc = new ArcService(store).list()[0]!
    same(restoredArc.primaryFactionId, named(factions, 'name', 'Amber Court').id, 'primary faction follows')
    same(restoredArc.rivalFactionId, named(factions, 'name', 'Salt Guild').id, 'rival faction follows')
  })

  it('rewrites an encounter down to the names in its initiative order', () => {
    const bundle = emptyBundle({
      characters: [character('char_A', 'Wren')],
      locations: [place('loc_SRC', 'Coldwater')],
      sessions: [session('ses_SRC', 4, 'Under the ice')],
      encounters: [
        encounter('enc_SRC', 'Ambush on the ice', {
          sessionId: 'ses_SRC',
          locationId: 'loc_SRC',
          initiative: [
            { characterId: 'char_A', name: 'Wren', initiative: 18, hp: 32, notes: '' },
            { characterId: null, name: 'Ice wolf', initiative: 12, hp: 20, notes: '' },
            { characterId: 'char_GONE', name: 'Bandit', initiative: 9, hp: 11, notes: 'fled' },
          ],
        }),
      ],
    })
    restoreBundle(bundle, store)
    const wren = new CharacterService(store).list()[0]!
    const restored = new EncounterService(store).list()[0]!
    same(restored.sessionId, new SessionService(store).list()[0]!.id, 'session reference follows')
    same(restored.locationId, new LocationService(store).list()[0]!.id, 'place reference follows')
    const order = restored.initiative as Row[]
    same(named(order, 'name', 'Wren').characterId, wren.id, 'the entry points at the restored character')
    same(named(order, 'name', 'Ice wolf').characterId, null, 'an entry with nobody behind it stays empty')
    count(order, 3, 'every entry keeps its place in the order')
    const bandit = named(order, 'name', 'Bandit')
    same(bandit.characterId, null, 'an entry whose character stayed behind is cleared')
    same(bandit.hp, 11, 'that entry keeps the rest of its row')
  })

  it('rewrites the giver and the arc on a quest', () => {
    const bundle = emptyBundle({
      characters: [character('char_A', 'Wren')],
      arcs: [arc('arc_SRC', 'Ice and salt')],
      quests: [quest('qst_SRC', 'Find the lens', { giverId: 'char_A', arcId: 'arc_SRC' })],
    })
    restoreBundle(bundle, store)
    const restored = new QuestService(store).list()[0]!
    same(restored.giverId, new CharacterService(store).list()[0]!.id, 'giver follows the character')
    same(restored.arcId, new ArcService(store).list()[0]!.id, 'arc reference follows the arc')
  })

  it('resolves each end of a relationship against the kind it names', () => {
    const bundle = emptyBundle({
      characters: [character('char_A', 'Wren')],
      factions: [faction('fac_A', 'Amber Court')],
      relationships: [
        relation('rel_SRC', { kind: 'character', id: 'char_A' }, { kind: 'faction', id: 'fac_A' }),
      ],
    })
    restoreBundle(bundle, store)
    const restored = new RelationshipService(store).list()[0]!
    const from = restored.from as Row
    const to = restored.to as Row
    same(from.id, new CharacterService(store).list()[0]!.id, 'the character end follows the character')
    same(to.id, new FactionService(store).list()[0]!.id, 'the faction end follows the faction')
    same(from.kind, 'character', 'the character end keeps its kind')
    same(to.kind, 'faction', 'the faction end keeps its kind')
  })

  it('drops the parent that would close a loop and keeps the other', () => {
    const bundle = emptyBundle({
      locations: [
        place('loc_A', 'Coldwater', { parentId: 'loc_B' }),
        place('loc_B', 'Dockside', { parentId: 'loc_A' }),
      ],
    })
    const result = restoreBundle(bundle, store)
    const places = new LocationService(store).list()
    count(places, 2, 'both places come back')
    same(result.restored.locations, 2, 'both places are counted as restored')
    const coldwater = named(places, 'name', 'Coldwater')
    const dockside = named(places, 'name', 'Dockside')
    same(coldwater.parentId, dockside.id, 'the first place keeps the parent it named')
    same(dockside.parentId, null, 'the place that would close the loop comes back with no parent')
  })

  it('drops the parent that closes a longer chain', () => {
    const bundle = emptyBundle({
      locations: [
        place('loc_A', 'Coldwater', { parentId: 'loc_B' }),
        place('loc_B', 'Dockside', { parentId: 'loc_C' }),
        place('loc_C', 'Saltmarsh', { parentId: 'loc_A' }),
      ],
    })
    restoreBundle(bundle, store)
    const places = new LocationService(store).list()
    const coldwater = named(places, 'name', 'Coldwater')
    const dockside = named(places, 'name', 'Dockside')
    const saltmarsh = named(places, 'name', 'Saltmarsh')
    same(coldwater.parentId, dockside.id, 'the first link is kept')
    same(dockside.parentId, saltmarsh.id, 'the second link is kept')
    same(saltmarsh.parentId, null, 'the link that closes the chain is dropped')
  })

  it('keeps a chain of parents that never closes', () => {
    const bundle = emptyBundle({
      locations: [
        place('loc_A', 'Coldwater', { parentId: 'loc_B' }),
        place('loc_B', 'Dockside', { parentId: 'loc_C' }),
        place('loc_C', 'Saltmarsh'),
      ],
    })
    restoreBundle(bundle, store)
    const places = new LocationService(store).list()
    same(named(places, 'name', 'Coldwater').parentId, named(places, 'name', 'Dockside').id, 'first link holds')
    same(named(places, 'name', 'Dockside').parentId, named(places, 'name', 'Saltmarsh').id, 'second link holds')
    same(named(places, 'name', 'Saltmarsh').parentId, null, 'the root has no parent')
  })

  it('lets a character keep three attuned items and no more', () => {
    const made = (n: number) => `2024-03-0${n}T00:00:00Z`
    const bundle = emptyBundle({
      characters: [character('char_A', 'Wren')],
      items: [
        item('itm_5', 'Fifth', { ownerId: 'char_A', attuned: true, createdAt: made(5) }),
        item('itm_1', 'First', { ownerId: 'char_A', attuned: true, createdAt: made(1) }),
        item('itm_4', 'Fourth', { ownerId: 'char_A', attuned: true, createdAt: made(4) }),
        item('itm_2', 'Second', { ownerId: 'char_A', attuned: true, createdAt: made(2) }),
        item('itm_3', 'Third', { ownerId: 'char_A', attuned: true, createdAt: made(3) }),
      ],
    })
    const result = restoreBundle(bundle, store)
    const items = new ItemService(store).list()
    count(items, 5, 'every item comes back')
    same(result.restored.items, 5, 'every item is counted as restored')
    const wren = new CharacterService(store).list()[0]!
    for (const name of ['First', 'Second', 'Third']) {
      same(named(items, 'name', name).attuned, true, `${name} keeps its attunement`)
    }
    for (const name of ['Fourth', 'Fifth']) {
      same(named(items, 'name', name).attuned, false, `${name} comes back unattuned`)
      same(named(items, 'name', name).ownerId, wren.id, `${name} still belongs to its owner`)
    }
  })

  it('settles a tie on attunement by the order the bundle lists', () => {
    const bundle = emptyBundle({
      characters: [character('char_A', 'Wren')],
      items: [
        item('itm_1', 'Alpha', { ownerId: 'char_A', attuned: true }),
        item('itm_2', 'Beta', { ownerId: 'char_A', attuned: true }),
        item('itm_3', 'Gamma', { ownerId: 'char_A', attuned: true }),
        item('itm_4', 'Delta', { ownerId: 'char_A', attuned: true }),
      ],
    })
    restoreBundle(bundle, store)
    const items = new ItemService(store).list()
    same(named(items, 'name', 'Alpha').attuned, true, 'the first listed keeps attunement')
    same(named(items, 'name', 'Beta').attuned, true, 'the second listed keeps attunement')
    same(named(items, 'name', 'Gamma').attuned, true, 'the third listed keeps attunement')
    same(named(items, 'name', 'Delta').attuned, false, 'the fourth listed loses it')
  })

  it('counts attunement against each owner on their own', () => {
    const bundle = emptyBundle({
      characters: [character('char_A', 'Wren'), character('char_B', 'Ilse')],
      items: [
        item('itm_1', 'A one', { ownerId: 'char_A', attuned: true }),
        item('itm_2', 'A two', { ownerId: 'char_A', attuned: true }),
        item('itm_3', 'A three', { ownerId: 'char_A', attuned: true }),
        item('itm_4', 'B one', { ownerId: 'char_B', attuned: true }),
        item('itm_5', 'B two', { ownerId: 'char_B', attuned: true }),
        item('itm_6', 'B three', { ownerId: 'char_B', attuned: true }),
      ],
    })
    restoreBundle(bundle, store)
    const items = new ItemService(store).list()
    for (const row of items) {
      same(row.attuned, true, `${String(row.name)} keeps its attunement`)
    }
  })

  it('does not spend a place on an item whose owner stayed behind', () => {
    const bundle = emptyBundle({
      characters: [character('char_A', 'Wren')],
      items: [
        item('itm_0', 'Orphan', { ownerId: 'char_GONE', attuned: true, createdAt: '2024-01-01T00:00:00Z' }),
        item('itm_1', 'First', { ownerId: 'char_A', attuned: true, createdAt: '2024-03-01T00:00:00Z' }),
        item('itm_2', 'Second', { ownerId: 'char_A', attuned: true, createdAt: '2024-03-02T00:00:00Z' }),
        item('itm_3', 'Third', { ownerId: 'char_A', attuned: true, createdAt: '2024-03-03T00:00:00Z' }),
      ],
    })
    restoreBundle(bundle, store)
    const items = new ItemService(store).list()
    same(named(items, 'name', 'Orphan').attuned, false, 'the ownerless item comes back unattuned')
    same(named(items, 'name', 'Orphan').ownerId, null, 'the ownerless item comes back unowned')
    for (const name of ['First', 'Second', 'Third']) {
      same(named(items, 'name', name).attuned, true, `${name} keeps its attunement`)
    }
  })

  it('rewrites a note onto the row it was written about', () => {
    const bundle = emptyBundle({
      items: [item('itm_SRC', 'Amber lens')],
      notes: [note('not_SRC', 'cracked along one edge', { kind: 'item', id: 'itm_SRC' })],
    })
    restoreBundle(bundle, store)
    const target = new NoteService(store).list()[0]!.target as Row
    same(target.id, new ItemService(store).list()[0]!.id, 'note target follows the item')
    same(target.kind, 'item', 'note target keeps its kind')
  })

  it('rewrites a note written about the campaign itself', () => {
    const bundle = emptyBundle({
      notes: [note('not_SRC', 'table rules live here', { kind: 'campaign', id: SOURCE })],
    })
    const result = restoreBundle(bundle, store)
    const target = new NoteService(store).list()[0]!.target as Row
    same(target.id, result.campaignId, 'the note points at the campaign that was written')
  })

  it('rewrites the marks a tag carries', () => {
    const bundle = emptyBundle({
      characters: [character('char_A', 'Wren')],
      quests: [quest('qst_SRC', 'Find the lens')],
      tags: [
        tag('tag_SRC', 'Coldwater', [
          { kind: 'character', id: 'char_A' },
          { kind: 'quest', id: 'qst_SRC' },
        ]),
      ],
    })
    restoreBundle(bundle, store)
    const marks = new TagService(store).list()[0]!.appliedTo as Row[]
    count(marks, 2, 'both marks survive')
    same(named(marks, 'kind', 'character').id, new CharacterService(store).list()[0]!.id, 'character mark follows')
    same(named(marks, 'kind', 'quest').id, new QuestService(store).list()[0]!.id, 'quest mark follows')
  })
})
