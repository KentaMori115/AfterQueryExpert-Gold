import { generateId } from '../ids'
import {
  asCampaignId,
  type CampaignId,
} from '../ids/brand'
import { DomainError } from '../lib/errors'
import { arcDraftSchema } from '../models/arc'
import { campaignDraftSchema } from '../models/campaign'
import { characterDraftSchema } from '../models/character'
import { downtimeDraftSchema } from '../models/downtime'
import { encounterDraftSchema } from '../models/encounter'
import { factionDraftSchema } from '../models/faction'
import { holidayDraftSchema } from '../models/holiday'
import { itemDraftSchema } from '../models/item'
import { locationDraftSchema, wouldCreateCycle } from '../models/location'
import { loreDraftSchema } from '../models/lore'
import { noteDraftSchema } from '../models/note'
import { questDraftSchema } from '../models/quest'
import { relationshipDraftSchema } from '../models/relationship'
import { sessionDraftSchema } from '../models/session'
import { slugifyTagName, tagDraftSchema } from '../models/tag'
import { timelineDraftSchema } from '../models/timeline'
import { getStore, type KeyValueStore } from '../persistence/storage'
import { ArcService } from '../services/arc-service'
import { CampaignService } from '../services/campaign-service'
import { CharacterService } from '../services/character-service'
import { DowntimeService } from '../services/downtime-service'
import { EncounterService } from '../services/encounter-service'
import { FactionService } from '../services/faction-service'
import { HolidayService } from '../services/holiday-service'
import { ItemService } from '../services/item-service'
import { LocationService } from '../services/location-service'
import { LoreService } from '../services/lore-service'
import { NoteService } from '../services/note-service'
import { QuestService } from '../services/quest-service'
import { RelationshipService } from '../services/relationship-service'
import { SessionService } from '../services/session-service'
import { TagService } from '../services/tag-service'
import { TimelineService } from '../services/timeline-service'
import { asTimestamp, now, type ISOTimestamp } from '../time/timestamps'

import {
  BUNDLE_MODULES,
  type BundleModule,
  type CampaignBundle,
  emptyTally,
  isRecord,
  type ModuleTally,
  moduleRows,
  rowId,
} from './bundle'
import { IdMap, type RefKind } from './idmap'

export interface RestoreResult {
  campaignId: CampaignId | null
  restored: ModuleTally
  skipped: ModuleTally
}

interface Planned {
  oldId: string
  newId: string
  row: Record<string, unknown>
}

/** Which module a note target or a tag mark points at. */
const TARGET_KINDS: Record<string, RefKind> = {
  campaign: 'campaign',
  character: 'characters',
  faction: 'factions',
  location: 'locations',
  session: 'sessions',
  arc: 'arcs',
  encounter: 'encounters',
  lore: 'lore',
  item: 'items',
  quest: 'quests',
}

const ID_PREFIX: Record<BundleModule, string> = {
  characters: 'char',
  factions: 'fac',
  locations: 'loc',
  sessions: 'ses',
  arcs: 'arc',
  encounters: 'enc',
  relationships: 'rel',
  lore: 'lor',
  items: 'itm',
  quests: 'qst',
  timeline: 'tle',
  notes: 'not',
  tags: 'tag',
  holidays: 'hol',
  downtime: 'dt',
}

interface RowSchema {
  safeParse(value: unknown): { success: boolean }
}

const ROW_SCHEMA: Record<BundleModule, RowSchema> = {
  characters: characterDraftSchema,
  factions: factionDraftSchema,
  locations: locationDraftSchema,
  sessions: sessionDraftSchema,
  arcs: arcDraftSchema,
  encounters: encounterDraftSchema,
  relationships: relationshipDraftSchema,
  lore: loreDraftSchema,
  items: itemDraftSchema,
  quests: questDraftSchema,
  timeline: timelineDraftSchema,
  notes: noteDraftSchema,
  tags: tagDraftSchema,
  holidays: holidayDraftSchema,
  downtime: downtimeDraftSchema,
}

/**
 * Put a campaign bundle back into a store as a campaign of its own.
 *
 * Ids are handed out fresh, so a bundle restored twice lands twice and neither
 * copy disturbs anything already stored. References travel with the rows: the
 * whole map of old id to new id is built before a single row is written, which
 * is what lets a location point at a parent further down its own list and a
 * faction point at a leader who points back at the faction.
 */
export function restoreBundle(
  bundle: CampaignBundle,
  store: KeyValueStore = getStore(),
): RestoreResult {
  const restored = emptyTally()
  const skipped = emptyTally()
  const campaignRow = isRecord(bundle?.campaign) ? bundle.campaign : null

  if (!campaignRow || !campaignDraftSchema.safeParse(campaignRow).success) {
    return { campaignId: null, restored, skipped }
  }

  const sourceCampaignId = typeof bundle.campaignId === 'string' ? bundle.campaignId : ''
  const newCampaignId = asCampaignId(generateId('camp'))
  const ids = new IdMap()
  ids.mint('campaign', sourceCampaignId, newCampaignId)

  // First pass: decide what survives and hand out every new id.
  const plan = {} as Record<BundleModule, Planned[]>
  for (const module of BUNDLE_MODULES) {
    plan[module] = planModule(bundle, module, sourceCampaignId, skipped, ids)
  }

  // Second pass: rewrite references and write the rows.
  const services = makeServices(store)
  const attuned = attunementAllowance(plan.items, ids)
  const settledLocations: Array<{ id: string; parentId: string | null }> = []
  for (const module of BUNDLE_MODULES) {
    for (const planned of plan[module]) {
      const row = resolveRow(module, planned, newCampaignId, ids, attuned, settledLocations)
      if (row === null) {
        skipped[module] += 1
        continue
      }
      try {
        writeRow(services, module, row)
        restored[module] += 1
      } catch (err) {
        if (!(err instanceof DomainError)) throw err
        skipped[module] += 1
      }
    }
  }

  services.campaigns.restore({
    ...(campaignRow as Record<string, unknown>),
    id: newCampaignId,
    sessionCount: restored.sessions,
    createdAt: stampOf(campaignRow.createdAt),
    updatedAt: now(),
  } as never)

  return { campaignId: newCampaignId, restored, skipped }
}

function planModule(
  bundle: CampaignBundle,
  module: BundleModule,
  sourceCampaignId: string,
  skipped: ModuleTally,
  ids: IdMap,
): Planned[] {
  const kept: Planned[] = []
  const seen = new Set<string>()
  const slugs = new Set<string>()

  for (const raw of moduleRows(bundle, module)) {
    const oldId = rowId(raw)
    const row = isRecord(raw) ? raw : null
    if (!row || oldId === null || seen.has(oldId)) {
      skipped[module] += 1
      continue
    }
    if (row.campaignId !== sourceCampaignId) {
      skipped[module] += 1
      continue
    }
    if (!ROW_SCHEMA[module].safeParse(row).success) {
      skipped[module] += 1
      continue
    }
    if (module === 'sessions' && !isOrdinal(row.number)) {
      skipped[module] += 1
      continue
    }
    if (module === 'tags') {
      const slug = slugifyTagName(String(row.name ?? ''))
      if (slugs.has(slug)) {
        skipped[module] += 1
        continue
      }
      slugs.add(slug)
    }
    seen.add(oldId)
    const newId = generateId(ID_PREFIX[module])
    ids.mint(module, oldId, newId)
    kept.push({ oldId, newId, row })
  }

  return kept
}

/**
 * Point a planned row at the ids it should have now. Null means the row cannot
 * be written at all, because something it cannot do without stayed behind.
 */
function resolveRow(
  module: BundleModule,
  planned: Planned,
  campaignId: CampaignId,
  ids: IdMap,
  attuned: Set<string>,
  settledLocations: Array<{ id: string; parentId: string | null }>,
): Record<string, unknown> | null {
  const row: Record<string, unknown> = {
    ...planned.row,
    id: planned.newId,
    campaignId,
    createdAt: stampOf(planned.row.createdAt),
    updatedAt: now(),
  }

  switch (module) {
    case 'characters':
      row.factionId = ids.lookup('factions', planned.row.factionId)
      row.homeId = ids.lookup('locations', planned.row.homeId)
      return row
    case 'factions':
      row.leaderId = ids.lookup('characters', planned.row.leaderId)
      row.seatId = ids.lookup('locations', planned.row.seatId)
      return row
    case 'locations': {
      const parentId = ids.lookup('locations', planned.row.parentId)
      // The row itself has to be in the picture, or the walk up the chain stops
      // at the link that has not been settled yet and the loop reads as open.
      const chain = [...settledLocations, { id: planned.newId, parentId }]
      const closesLoop =
        parentId !== null &&
        wouldCreateCycle(parentId as never, planned.newId as never, chain as never)
      row.parentId = closesLoop ? null : parentId
      settledLocations.push({ id: planned.newId, parentId: row.parentId as string | null })
      return row
    }
    case 'sessions':
      row.locationId = ids.lookup('locations', planned.row.locationId)
      row.attendees = ids.lookupAll('characters', planned.row.attendees)
      return row
    case 'arcs':
      row.primaryFactionId = ids.lookup('factions', planned.row.primaryFactionId)
      row.rivalFactionId = ids.lookup('factions', planned.row.rivalFactionId)
      return row
    case 'encounters':
      row.sessionId = ids.lookup('sessions', planned.row.sessionId)
      row.locationId = ids.lookup('locations', planned.row.locationId)
      row.initiative = resolveInitiative(planned.row.initiative, ids)
      return row
    case 'relationships': {
      const from = resolveEndpoint(planned.row.from, ids)
      const to = resolveEndpoint(planned.row.to, ids)
      if (from === null || to === null) return null
      row.from = from
      row.to = to
      return row
    }
    case 'items': {
      const owner = ids.lookup('characters', planned.row.ownerId)
      row.ownerId = owner
      row.attuned = owner !== null && attuned.has(planned.oldId)
      return row
    }
    case 'quests':
      row.giverId = ids.lookup('characters', planned.row.giverId)
      row.arcId = ids.lookup('arcs', planned.row.arcId)
      return row
    case 'notes': {
      const target = resolveTarget(planned.row.target, ids)
      if (target === null) return null
      row.target = target
      return row
    }
    case 'tags':
      row.appliedTo = resolveMarks(planned.row.appliedTo, ids)
      return row
    case 'downtime': {
      const characterId = ids.lookup('characters', planned.row.characterId)
      if (characterId === null) return null
      row.characterId = characterId
      return row
    }
    default:
      return row
  }
}

/**
 * Which items may come back attuned. Attunement asks something of the person
 * wearing it, so a character can only hold so much of it at once: the earliest
 * three by created stamp keep it, and the bundle's own order settles a tie.
 */
function attunementAllowance(items: Planned[], ids: IdMap): Set<string> {
  const ATTUNEMENT_LIMIT = 3
  const byOwner = new Map<string, Planned[]>()

  for (const planned of items) {
    if (planned.row.attuned !== true) continue
    const owner = ids.lookup('characters', planned.row.ownerId)
    if (owner === null) continue
    const held = byOwner.get(owner)
    if (held) held.push(planned)
    else byOwner.set(owner, [planned])
  }

  const allowed = new Set<string>()
  for (const held of byOwner.values()) {
    const ordered = held
      .map((planned, order) => ({ planned, order, made: stampOf(planned.row.createdAt) }))
      .sort((a, b) => (a.made === b.made ? a.order - b.order : a.made < b.made ? -1 : 1))
    for (const entry of ordered.slice(0, ATTUNEMENT_LIMIT)) {
      allowed.add(entry.planned.oldId)
    }
  }

  return allowed
}

function resolveInitiative(raw: unknown, ids: IdMap): unknown[] {
  if (!Array.isArray(raw)) return []
  return raw.map((entry) =>
    isRecord(entry) ? { ...entry, characterId: ids.lookup('characters', entry.characterId) } : entry,
  )
}

function resolveEndpoint(raw: unknown, ids: IdMap): Record<string, unknown> | null {
  if (!isRecord(raw)) return null
  const kind = TARGET_KINDS[String(raw.kind)]
  if (kind === undefined || kind === 'campaign') return null
  const id = ids.lookup(kind, raw.id)
  return id === null ? null : { kind: raw.kind, id }
}

function resolveTarget(raw: unknown, ids: IdMap): Record<string, unknown> | null {
  if (!isRecord(raw)) return null
  const kind = TARGET_KINDS[String(raw.kind)]
  if (kind === undefined) return null
  const id = ids.lookup(kind, raw.id)
  return id === null ? null : { kind: raw.kind, id }
}

function resolveMarks(raw: unknown, ids: IdMap): Array<Record<string, unknown>> {
  if (!Array.isArray(raw)) return []
  const out: Array<Record<string, unknown>> = []
  for (const mark of raw) {
    if (!isRecord(mark)) continue
    const kind = TARGET_KINDS[String(mark.kind)]
    if (kind === undefined || kind === 'campaign') continue
    const id = ids.lookup(kind, mark.id)
    if (id === null) continue
    out.push({ kind: mark.kind, id })
  }
  return out
}

interface Services {
  campaigns: CampaignService
  characters: CharacterService
  factions: FactionService
  locations: LocationService
  sessions: SessionService
  arcs: ArcService
  encounters: EncounterService
  relationships: RelationshipService
  lore: LoreService
  items: ItemService
  quests: QuestService
  timeline: TimelineService
  notes: NoteService
  tags: TagService
  holidays: HolidayService
  downtime: DowntimeService
}

function makeServices(store: KeyValueStore): Services {
  return {
    campaigns: new CampaignService(store),
    characters: new CharacterService(store),
    factions: new FactionService(store),
    locations: new LocationService(store),
    sessions: new SessionService(store),
    arcs: new ArcService(store),
    encounters: new EncounterService(store),
    relationships: new RelationshipService(store),
    lore: new LoreService(store),
    items: new ItemService(store),
    quests: new QuestService(store),
    timeline: new TimelineService(store),
    notes: new NoteService(store),
    tags: new TagService(store),
    holidays: new HolidayService(store),
    downtime: new DowntimeService(store),
  }
}

function writeRow(services: Services, module: BundleModule, row: Record<string, unknown>): void {
  switch (module) {
    case 'characters':
      services.characters.restore(row as never)
      return
    case 'factions':
      services.factions.restore(row as never)
      return
    case 'locations':
      services.locations.restore(row as never)
      return
    case 'sessions':
      services.sessions.restore(row as never)
      return
    case 'arcs':
      services.arcs.restore(row as never)
      return
    case 'encounters':
      services.encounters.restore(row as never)
      return
    case 'relationships':
      services.relationships.restore(row as never)
      return
    case 'lore':
      services.lore.restore(row as never)
      return
    case 'items':
      services.items.restore(row as never)
      return
    case 'quests':
      services.quests.restore(row as never)
      return
    case 'timeline':
      services.timeline.restore(row as never)
      return
    case 'notes':
      services.notes.restore(row as never)
      return
    case 'tags':
      services.tags.restore(row as never)
      return
    case 'holidays':
      services.holidays.restore(row as never)
      return
    case 'downtime':
      services.downtime.restore(row as never)
      return
  }
}

function isOrdinal(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1
}

function stampOf(value: unknown): ISOTimestamp {
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) {
    return asTimestamp(value)
  }
  return now()
}
