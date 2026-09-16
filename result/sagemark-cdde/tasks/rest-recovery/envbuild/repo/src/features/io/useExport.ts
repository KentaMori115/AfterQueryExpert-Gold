import type { CampaignId } from '@core/ids'

import { useCampaignStore } from '@features/campaigns/store'
import { useCharacterStore } from '@features/characters/store'
import { useFactionStore } from '@features/factions/store'
import { useLocationStore } from '@features/locations/store'
import { useLoreStore } from '@features/lore/store'
import { useQuestStore } from '@features/quests/store'
import { useSessionStore } from '@features/sessions/store'
import { useArcStore } from '@features/arcs/store'
import { useEncounterStore } from '@features/encounters/store'
import { useRelationshipStore } from '@features/relationships/store'
import { useItemStore } from '@features/items/store'
import { useTimelineStore } from '@features/timeline/store'
import { useNoteStore } from '@features/notes/store'
import { useTagStore } from '@features/tags/store'
import { useHolidayStore } from '@features/holidays/store'
import { useDowntimeStore } from '@features/downtime/store'
import { useTreasuryStore } from '@features/treasury/store'

export type CampaignExportVersion = 1 | 2

export interface CampaignExport {
  version: CampaignExportVersion
  exportedAt: string
  campaignId: CampaignId
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
  // v2 additions
  notes?: unknown[]
  tags?: unknown[]
  holidays?: unknown[]
  downtime?: unknown[]
  treasury?: unknown
}

export function buildExport(campaignId: CampaignId, version: CampaignExportVersion = 2): CampaignExport | null {
  const campaigns = useCampaignStore()
  const campaign = campaigns.all.find((c) => c.id === campaignId)
  if (!campaign) return null

  const base: CampaignExport = {
    version,
    exportedAt: new Date().toISOString(),
    campaignId,
    campaign,
    characters: useCharacterStore().forCampaign(campaignId),
    factions: useFactionStore().forCampaign(campaignId),
    locations: useLocationStore().forCampaign(campaignId),
    sessions: useSessionStore().forCampaign(campaignId),
    arcs: useArcStore().forCampaign(campaignId),
    encounters: useEncounterStore().forCampaign(campaignId),
    relationships: useRelationshipStore().forCampaign(campaignId),
    lore: useLoreStore().forCampaign(campaignId),
    items: useItemStore().forCampaign(campaignId),
    quests: useQuestStore().forCampaign(campaignId),
    timeline: useTimelineStore().forCampaign(campaignId),
  }

  if (version >= 2) {
    base.notes = useNoteStore().forCampaign(campaignId)
    base.tags = useTagStore().forCampaign(campaignId)
    base.holidays = useHolidayStore().forCampaign(campaignId)
    base.downtime = useDowntimeStore().forCampaign(campaignId)
    base.treasury = {
      purse: useTreasuryStore().purseFor(campaignId),
      entries: useTreasuryStore().entriesFor(campaignId),
    }
  }

  return base
}

export function exportAsJson(campaignId: CampaignId, version: CampaignExportVersion = 2): string | null {
  const data = buildExport(campaignId, version)
  if (!data) return null
  return JSON.stringify(data, null, 2)
}

export function fileNameFor(campaignName: string): string {
  const safe = campaignName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const stamp = new Date().toISOString().slice(0, 10)
  return `${safe || 'campaign'}-${stamp}.sagemark.json`
}
