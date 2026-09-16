/**
 * Restoring a bundle: what is refused, what is dropped, and what the tally says.
 *
 * The module under test is pulled in after this file has been evaluated, so the
 * handful of primitives these checks use are captured up front.
 */
import { beforeEach, describe, it } from 'vitest'

const objectIs = Object.is
const isArray = Array.isArray
const keysOf = Object.keys

type Row = Record<string, unknown>

interface Tally {
  campaignId: string | null
  restored: Record<string, number>
  skipped: Record<string, number>
}

let restoreBundle: (bundle: Row, store: unknown) => Tally
let MemoryStore: new () => unknown
let CampaignService: new (store: unknown) => { list(): Row[]; get(id: string): Row }
let CharacterService: new (store: unknown) => { list(): Row[] }
let LocationService: new (store: unknown) => { list(): Row[] }
let SessionService: new (store: unknown) => { list(): Row[] }
let RelationshipService: new (store: unknown) => { list(): Row[] }
let ItemService: new (store: unknown) => { list(): Row[] }
let NoteService: new (store: unknown) => { list(): Row[] }
let TagService: new (store: unknown) => { list(): Row[] }
let HolidayService: new (store: unknown) => { list(): Row[] }
let DowntimeService: new (store: unknown) => { list(): Row[] }
let TimelineService: new (store: unknown) => { list(): Row[] }

let loaded = false

beforeEach(async () => {
  if (loaded) return
  restoreBundle = (await import('./restore')).restoreBundle as never
  MemoryStore = (await import('../persistence/storage')).MemoryStore as never
  CampaignService = (await import('../services/campaign-service')).CampaignService as never
  CharacterService = (await import('../services/character-service')).CharacterService as never
  LocationService = (await import('../services/location-service')).LocationService as never
  SessionService = (await import('../services/session-service')).SessionService as never
  RelationshipService = (await import('../services/relationship-service')).RelationshipService as never
  ItemService = (await import('../services/item-service')).ItemService as never
  NoteService = (await import('../services/note-service')).NoteService as never
  TagService = (await import('../services/tag-service')).TagService as never
  HolidayService = (await import('../services/holiday-service')).HolidayService as never
  DowntimeService = (await import('../services/downtime-service')).DowntimeService as never
  TimelineService = (await import('../services/timeline-service')).TimelineService as never
  loaded = true
})

function intact(): void {
  if (Object.is !== objectIs || Array.isArray !== isArray || Object.keys !== keysOf) {
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
      tagline: '',
      system: 'dnd5e',
      status: 'active',
      startedAt: null,
      lastPlayedAt: null,
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
    kind: 'pc', name, pronouns: '', ancestry: '', vocation: '', level: 3,
    disposition: 'unknown', factionId: null, homeId: null, blurb: '', alive: true,
    ...STAMPS,
    ...over,
  }
}

function place(id: string, name: string, over: Row = {}): Row {
  return {
    id,
    campaignId: SOURCE,
    parentId: null, name, kind: 'town', shortDescription: '', notes: '', visited: false,
    ...STAMPS,
    ...over,
  }
}

function session(id: string, number: unknown, title: string, over: Row = {}): Row {
  return {
    id,
    campaignId: SOURCE,
    number, title, playedAt: '2024-03-03T00:00:00Z', durationMinutes: 180,
    locationId: null, attendees: [], summary: '', log: '',
    ...STAMPS,
    ...over,
  }
}

function item(id: string, name: string, over: Row = {}): Row {
  return {
    id,
    campaignId: SOURCE,
    name, kind: 'wondrous', rarity: 'rare', magical: true, attuned: false,
    ownerId: null, description: '', valueGp: 120,
    ...STAMPS,
    ...over,
  }
}

function note(id: string, body: string, target: Row): Row {
  return {
    id,
    campaignId: SOURCE,
    target, title: '', body, priority: 'normal', pinned: false,
    remindAt: null, resolvedAt: null,
    ...STAMPS,
  }
}

function tag(id: string, name: string, appliedTo: Row[] = []): Row {
  return {
    id,
    campaignId: SOURCE,
    name, slug: name.toLowerCase(), tone: 'moss', description: '', appliedTo,
    ...STAMPS,
  }
}

function relation(id: string, from: Row, to: Row): Row {
  return {
    id,
    campaignId: SOURCE,
    from, to, kind: 'ally', intensity: 2, note: '', reciprocal: true,
    ...STAMPS,
  }
}

function holiday(id: string, name: string, month: number, day: number): Row {
  return {
    id,
    campaignId: SOURCE,
    name, month, day, kind: 'civic', observance: '',
    ...STAMPS,
  }
}

function downtime(id: string, characterId: string, kind: string): Row {
  return {
    id,
    campaignId: SOURCE,
    characterId, kind, outcome: 'planned', weeks: 2, description: '', reward: '',
    ...STAMPS,
  }
}

function timelineEvent(id: string, title: string, year: number): Row {
  return {
    id,
    campaignId: SOURCE,
    title, description: '', date: { year, month: null, day: null },
    era: 'present', significance: 'notable', revealed: true,
    ...STAMPS,
  }
}

function named(rows: Row[], key: string, value: string): Row {
  const found = rows.find((row) => row[key] === value)
  if (!found) throw new Error(`no restored row with ${key} "${value}"`)
  return found
}

describe('restoreBundle dropped references', () => {
  let store: unknown

  beforeEach(() => {
    store = new MemoryStore()
  })

  it('empties a reference the bundle never carried', () => {
    const bundle = emptyBundle({
      characters: [character('char_A', 'Wren', { factionId: 'fac_MISSING', homeId: 'loc_MISSING' })],
    })
    const result = restoreBundle(bundle, store)
    const wren = new CharacterService(store).list()[0]!
    same(wren.factionId, null, 'the missing faction leaves an empty slot')
    same(wren.homeId, null, 'the missing home leaves an empty slot')
    same(result.restored.characters, 1, 'the character still comes back')
  })

  it('empties a parent that stayed behind', () => {
    const bundle = emptyBundle({ locations: [place('loc_A', 'Dockside', { parentId: 'loc_MISSING' })] })
    restoreBundle(bundle, store)
    same(new LocationService(store).list()[0]!.parentId, null, 'the missing parent leaves an empty slot')
  })

  it('drops an attendee who did not come back', () => {
    const bundle = emptyBundle({
      characters: [character('char_A', 'Wren')],
      sessions: [session('ses_A', 3, 'Under the ice', { attendees: ['char_A', 'char_MISSING'] })],
    })
    restoreBundle(bundle, store)
    const attendees = new SessionService(store).list()[0]!.attendees as string[]
    count(attendees, 1, 'only the attendee who came back is on the list')
    same(attendees[0], new CharacterService(store).list()[0]!.id, 'the survivor is the restored character')
  })

  it('drops a tag mark whose row stayed behind and keeps the tag', () => {
    const bundle = emptyBundle({
      characters: [character('char_A', 'Wren')],
      tags: [tag('tag_A', 'Coldwater', [
        { kind: 'character', id: 'char_A' },
        { kind: 'item', id: 'itm_MISSING' },
      ])],
    })
    const result = restoreBundle(bundle, store)
    const marks = new TagService(store).list()[0]!.appliedTo as Row[]
    count(marks, 1, 'only the mark that resolves survives')
    same(result.restored.tags, 1, 'the tag itself still comes back')
  })

  it('hands back an item whose owner stayed behind, unowned and unattuned', () => {
    const bundle = emptyBundle({
      characters: [character('char_A', 'Wren')],
      items: [
        item('itm_A', 'Amber lens', { ownerId: 'char_A', attuned: true }),
        item('itm_B', 'Salt rod', { ownerId: 'char_MISSING', attuned: true }),
      ],
    })
    restoreBundle(bundle, store)
    const items = new ItemService(store).list()
    const lens = named(items, 'name', 'Amber lens')
    const rod = named(items, 'name', 'Salt rod')
    same(lens.ownerId, new CharacterService(store).list()[0]!.id, 'the lens follows its owner')
    same(lens.attuned, true, 'the lens keeps its attunement')
    same(rod.ownerId, null, 'the rod comes back unowned')
    same(rod.attuned, false, 'the rod comes back unattuned')
  })

  it('refuses a relationship with an end that stayed behind', () => {
    const bundle = emptyBundle({
      characters: [character('char_A', 'Wren')],
      relationships: [
        relation('rel_A', { kind: 'character', id: 'char_A' }, { kind: 'faction', id: 'fac_MISSING' }),
      ],
    })
    const result = restoreBundle(bundle, store)
    count(new RelationshipService(store).list(), 0, 'nothing is written for that relationship')
    same(result.restored.relationships, 0, 'no relationship is counted as restored')
    same(result.skipped.relationships, 1, 'the relationship is counted as skipped')
  })

  it('refuses a note whose subject stayed behind', () => {
    const bundle = emptyBundle({
      items: [item('itm_A', 'Amber lens')],
      notes: [
        note('not_A', 'about the lens', { kind: 'item', id: 'itm_A' }),
        note('not_B', 'about a ghost', { kind: 'item', id: 'itm_MISSING' }),
      ],
    })
    const result = restoreBundle(bundle, store)
    count(new NoteService(store).list(), 1, 'only the note with a subject is written')
    same(result.restored.notes, 1, 'one note is counted as restored')
    same(result.skipped.notes, 1, 'the orphan note is counted as skipped')
  })

  it('refuses downtime whose character stayed behind', () => {
    const bundle = emptyBundle({
      characters: [character('char_A', 'Wren')],
      downtime: [downtime('dt_A', 'char_A', 'crafting'), downtime('dt_B', 'char_MISSING', 'crafting')],
    })
    const result = restoreBundle(bundle, store)
    count(new DowntimeService(store).list(), 1, 'only the activity with a character is written')
    same(new DowntimeService(store).list()[0]!.characterId, new CharacterService(store).list()[0]!.id, 'it follows the character')
    same(result.skipped.downtime, 1, 'the orphan activity is counted as skipped')
  })
})

describe('restoreBundle refusals', () => {
  let store: unknown

  beforeEach(() => {
    store = new MemoryStore()
  })

  it('skips a row its own rules reject and keeps going', () => {
    const bundle = emptyBundle({
      characters: [
        character('char_A', 'Wren'),
        character('char_B', '   '),
        character('char_C', 'Ilse', { level: 900 }),
        character('char_D', 'Rook'),
      ],
    })
    const result = restoreBundle(bundle, store)
    count(new CharacterService(store).list(), 2, 'the two sound characters are written')
    same(result.restored.characters, 2, 'two characters are counted as restored')
    same(result.skipped.characters, 2, 'the blank name and the silly level are counted as skipped')
  })

  it('skips a row tagged with another campaign', () => {
    const bundle = emptyBundle({
      characters: [character('char_A', 'Wren'), character('char_B', 'Stray', { campaignId: 'camp_OTHER' })],
    })
    const result = restoreBundle(bundle, store)
    count(new CharacterService(store).list(), 1, 'the stray row is not written')
    same(new CharacterService(store).list()[0]!.name, 'Wren', 'the campaign row is the one written')
    same(result.skipped.characters, 1, 'the stray row is counted as skipped')
  })

  it('keeps the first of two rows sharing an id', () => {
    const bundle = emptyBundle({
      characters: [character('char_A', 'Wren'), character('char_A', 'Wren the second')],
    })
    const result = restoreBundle(bundle, store)
    count(new CharacterService(store).list(), 1, 'only one row is written')
    same(new CharacterService(store).list()[0]!.name, 'Wren', 'the first row is the one kept')
    same(result.skipped.characters, 1, 'the repeat is counted as skipped')
  })

  it('skips a tag whose name is already spoken for', () => {
    const bundle = emptyBundle({
      tags: [tag('tag_A', 'Coldwater'), tag('tag_B', 'coldwater'), tag('tag_C', 'Salt')],
    })
    const result = restoreBundle(bundle, store)
    count(new TagService(store).list(), 2, 'two tags are written')
    same(result.restored.tags, 2, 'two tags are counted as restored')
    same(result.skipped.tags, 1, 'the repeated name is counted as skipped')
  })

  it('skips a session without a usable ordinal', () => {
    const bundle = emptyBundle({
      sessions: [
        session('ses_A', 4, 'Under the ice'),
        session('ses_B', 0, 'Nowhere'),
        session('ses_C', 'seven', 'Nonsense'),
      ],
    })
    const result = restoreBundle(bundle, store)
    count(new SessionService(store).list(), 1, 'only the numbered session is written')
    same(result.skipped.sessions, 2, 'both unusable ordinals are counted as skipped')
  })

  it('writes nothing at all when the campaign row is broken', () => {
    const bundle = emptyBundle({
      campaign: { id: SOURCE, name: '', createdAt: '2024-01-01T00:00:00Z' },
      characters: [character('char_A', 'Wren')],
      items: [item('itm_A', 'Amber lens')],
    })
    const result = restoreBundle(bundle, store)
    same(result.campaignId, null, 'no campaign is reported')
    count(new CampaignService(store).list(), 0, 'no campaign is written')
    count(new CharacterService(store).list(), 0, 'no character is written')
    count(new ItemService(store).list(), 0, 'no item is written')
    same(result.restored.characters, 0, 'nothing is counted as restored')
    same(result.skipped.characters, 0, 'nothing is counted as skipped either')
  })
})

describe('restoreBundle tally', () => {
  let store: unknown

  beforeEach(() => {
    store = new MemoryStore()
  })

  it('counts every row it was handed exactly once', () => {
    const bundle = emptyBundle({
      characters: [character('char_A', 'Wren'), character('char_B', ''), character('char_C', 'Ilse')],
      locations: [place('loc_A', 'Coldwater')],
      holidays: [holiday('hol_A', 'Thawfeast', 3, 12), holiday('hol_B', 'Broken', 99, 1)],
    })
    const result = restoreBundle(bundle, store)
    same(result.restored.characters + result.skipped.characters, 3, 'every character row is counted once')
    same(result.restored.locations + result.skipped.locations, 1, 'every location row is counted once')
    same(result.restored.holidays + result.skipped.holidays, 2, 'every holiday row is counted once')
    same(result.restored.holidays, 1, 'the sound holiday is restored')
    count(new HolidayService(store).list(), 1, 'one holiday is written')
  })

  it('reports a count for every module a bundle can carry', () => {
    const result = restoreBundle(emptyBundle(), store)
    const modules = keysOf(result.restored)
    for (const module of ['characters', 'factions', 'locations', 'sessions', 'arcs', 'encounters',
      'relationships', 'lore', 'items', 'quests', 'timeline', 'notes', 'tags', 'holidays', 'downtime']) {
      ok(modules.includes(module), `restored has a count for ${module}`)
      same(result.restored[module], 0, `${module} counts zero on an empty bundle`)
      same(result.skipped[module], 0, `${module} skips nothing on an empty bundle`)
    }
  })

  it('takes a version 1 bundle and counts the later modules as empty', () => {
    const v1 = emptyBundle({ version: 1, timeline: [timelineEvent('tle_A', 'The long winter', 812)] })
    delete v1.notes
    delete v1.tags
    delete v1.holidays
    delete v1.downtime
    const result = restoreBundle(v1, store)
    ok(typeof result.campaignId === 'string', 'a version 1 bundle still restores')
    same(result.restored.timeline, 1, 'the timeline event comes back')
    count(new TimelineService(store).list(), 1, 'the event is written')
    same(result.restored.notes, 0, 'notes count zero')
    same(result.restored.tags, 0, 'tags count zero')
    same(result.restored.holidays, 0, 'holidays count zero')
    same(result.restored.downtime, 0, 'downtime counts zero')
  })

  it('numbers the campaign by the sessions that actually came back', () => {
    const bundle = emptyBundle({
      sessions: [
        session('ses_A', 4, 'Under the ice'),
        session('ses_B', 5, 'Salt and smoke'),
        session('ses_C', -2, 'Nowhere'),
      ],
    })
    const result = restoreBundle(bundle, store)
    const campaign = new CampaignService(store).get(String(result.campaignId))
    same(campaign.sessionCount, 2, 'the count follows the sessions that were written')
    same(result.restored.sessions, 2, 'two sessions are counted as restored')
  })

  it('takes back the rows that point at nothing at all', () => {
    const bundle = emptyBundle({
      timeline: [timelineEvent('tle_A', 'The long winter', 812), timelineEvent('tle_B', 'Salt war', 840)],
    })
    const result = restoreBundle(bundle, store)
    count(new TimelineService(store).list(), 2, 'both events are written')
    same(result.restored.timeline, 2, 'both events are counted as restored')
    const titles = new TimelineService(store).list().map((row) => row.title)
    ok(titles.includes('The long winter'), 'the first event survives')
    ok(titles.includes('Salt war'), 'the second event survives')
  })

  it('ignores a mark pointing into another campaign', () => {
    const bundle = emptyBundle({
      characters: [character('char_A', 'Wren')],
      items: [item('itm_A', 'Amber lens', { ownerId: 'char_A' })],
      tags: [tag('tag_A', 'Coldwater', [{ kind: 'item', id: 'itm_STRANGER' }])],
      notes: [note('not_A', 'about a stranger', { kind: 'character', id: 'char_STRANGER' })],
    })
    const result = restoreBundle(bundle, store)
    count(new TagService(store).list()[0]!.appliedTo as Row[], 0, 'the stray mark is dropped')
    same(result.restored.tags, 1, 'the tag is still restored')
    same(result.skipped.notes, 1, 'the note about a stranger is skipped')
    count(new NoteService(store).list(), 0, 'no note is written')
  })

  it('keeps the ordinal each session arrived with', () => {
    const bundle = emptyBundle({
      sessions: [session('ses_A', 7, 'Seven'), session('ses_B', 3, 'Three')],
    })
    restoreBundle(bundle, store)
    const sessions = new SessionService(store).list()
    same(named(sessions, 'title', 'Seven').number, 7, 'the seventh session is still the seventh')
    same(named(sessions, 'title', 'Three').number, 3, 'the third session is still the third')
  })
})
