import { z } from 'zod'

import type { CampaignExport } from './useExport'

const v1Schema = z.object({
  version: z.literal(1),
  campaignId: z.string(),
  campaign: z.unknown(),
  characters: z.array(z.unknown()),
  factions: z.array(z.unknown()),
  locations: z.array(z.unknown()),
  sessions: z.array(z.unknown()),
  arcs: z.array(z.unknown()),
  encounters: z.array(z.unknown()),
  relationships: z.array(z.unknown()),
  lore: z.array(z.unknown()),
  items: z.array(z.unknown()),
  quests: z.array(z.unknown()),
  timeline: z.array(z.unknown()),
})

const v2Schema = v1Schema.extend({
  version: z.literal(2),
  notes: z.array(z.unknown()).optional(),
  tags: z.array(z.unknown()).optional(),
  holidays: z.array(z.unknown()).optional(),
  downtime: z.array(z.unknown()).optional(),
  treasury: z.unknown().optional(),
})

const anyVersion = z.union([v1Schema, v2Schema])

export interface ImportPreview {
  version: 1 | 2
  campaignId: string
  counts: Record<string, number>
  modulesPresent: string[]
}

export class ImportParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImportParseError'
  }
}

export function parseImport(raw: string): CampaignExport {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new ImportParseError('input is not valid JSON')
  }
  const result = anyVersion.safeParse(parsed)
  if (!result.success) {
    throw new ImportParseError('bundle does not match a known sagemark export')
  }
  return result.data as CampaignExport
}

export function previewImport(raw: string): ImportPreview {
  const data = parseImport(raw)
  const counts: Record<string, number> = {
    characters: data.characters.length,
    factions: data.factions.length,
    locations: data.locations.length,
    sessions: data.sessions.length,
    arcs: data.arcs.length,
    encounters: data.encounters.length,
    relationships: data.relationships.length,
    lore: data.lore.length,
    items: data.items.length,
    quests: data.quests.length,
    timeline: data.timeline.length,
  }
  const modulesPresent = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([k]) => k)
  if (data.version === 2) {
    if (data.notes) counts.notes = data.notes.length
    if (data.tags) counts.tags = data.tags.length
    if (data.holidays) counts.holidays = data.holidays.length
    if (data.downtime) counts.downtime = data.downtime.length
    if (data.notes && data.notes.length > 0) modulesPresent.push('notes')
    if (data.tags && data.tags.length > 0) modulesPresent.push('tags')
    if (data.holidays && data.holidays.length > 0) modulesPresent.push('holidays')
    if (data.downtime && data.downtime.length > 0) modulesPresent.push('downtime')
    if (data.treasury) modulesPresent.push('treasury')
  }
  return {
    version: data.version,
    campaignId: data.campaignId,
    counts,
    modulesPresent,
  }
}
