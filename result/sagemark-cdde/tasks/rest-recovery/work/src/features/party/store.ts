import { defineStore } from 'pinia'
import { ref } from 'vue'

import type { CampaignId, CharacterId } from '@core/ids'
import { getStore } from '@core/persistence/storage'
import type { HitDicePool } from '@core/rules/hit-dice'
import type { RestEntry, RestKind } from '@core/rules/rest'
import { asTimestamp, now, type ISOTimestamp } from '@core/time/timestamps'

const STORAGE_KEY = 'party:lineup:v1'

export interface PartyMember {
  characterId: CharacterId
  status: 'active' | 'benched' | 'absent'
  joinedAt: ISOTimestamp
}

export interface RestRecord {
  kind: RestKind
  at: ISOTimestamp
  entries: ReadonlyArray<RestEntry>
}

export interface PartyState {
  campaignId: CampaignId
  members: PartyMember[]
  motto: string
  sharedNotes: string
  hitDice: Record<string, HitDicePool>
  lastRest: RestRecord | null
  updatedAt: ISOTimestamp
}

interface SerialState {
  byCampaign: Record<string, PartyState>
}

function load(): SerialState {
  const raw = getStore().get(STORAGE_KEY)
  if (!raw) return { byCampaign: {} }
  try {
    const parsed = JSON.parse(raw) as SerialState
    if (parsed && parsed.byCampaign) return parsed
  } catch {
    return { byCampaign: {} }
  }
  return { byCampaign: {} }
}

function persist(state: SerialState): void {
  getStore().set(STORAGE_KEY, JSON.stringify(state))
}

function clone(state: SerialState): SerialState {
  return { byCampaign: { ...state.byCampaign } }
}

function emptyParty(campaignId: CampaignId): PartyState {
  return {
    campaignId,
    members: [],
    motto: '',
    sharedNotes: '',
    hitDice: {},
    lastRest: null,
    updatedAt: now(),
  }
}

export const usePartyStore = defineStore('party', () => {
  const state = ref<SerialState>(load())

  function getParty(campaignId: CampaignId): PartyState {
    const stored = state.value.byCampaign[campaignId]
    if (!stored) return emptyParty(campaignId)
    // Parties written before the camp ledger existed carry neither field.
    return { ...stored, hitDice: stored.hitDice ?? {}, lastRest: stored.lastRest ?? null }
  }

  function setParty(party: PartyState): void {
    const next = clone(state.value)
    next.byCampaign[party.campaignId] = { ...party, updatedAt: now() }
    state.value = next
    persist(state.value)
  }

  function addMember(campaignId: CampaignId, characterId: CharacterId): PartyState {
    const current = getParty(campaignId)
    if (current.members.some((m) => m.characterId === characterId)) return current
    const next: PartyState = {
      ...current,
      members: [
        ...current.members,
        { characterId, status: 'active', joinedAt: asTimestamp(new Date()) },
      ],
    }
    setParty(next)
    return next
  }

  function removeMember(campaignId: CampaignId, characterId: CharacterId): PartyState {
    const current = getParty(campaignId)
    const next: PartyState = {
      ...current,
      members: current.members.filter((m) => m.characterId !== characterId),
    }
    setParty(next)
    return next
  }

  function setStatus(
    campaignId: CampaignId,
    characterId: CharacterId,
    status: PartyMember['status'],
  ): void {
    const current = getParty(campaignId)
    const next: PartyState = {
      ...current,
      members: current.members.map((m) =>
        m.characterId === characterId ? { ...m, status } : m,
      ),
    }
    setParty(next)
  }

  function setMotto(campaignId: CampaignId, motto: string): void {
    setParty({ ...getParty(campaignId), motto: motto.trim() })
  }

  function setSharedNotes(campaignId: CampaignId, sharedNotes: string): void {
    setParty({ ...getParty(campaignId), sharedNotes })
  }

  function hitDiceFor(campaignId: CampaignId, characterId: CharacterId): HitDicePool | null {
    return getParty(campaignId).hitDice[characterId] ?? null
  }

  function setHitDice(
    campaignId: CampaignId,
    characterId: CharacterId,
    pool: HitDicePool,
  ): void {
    const current = getParty(campaignId)
    setParty({ ...current, hitDice: { ...current.hitDice, [characterId]: pool } })
  }

  function rememberRest(
    campaignId: CampaignId,
    kind: RestKind,
    entries: ReadonlyArray<RestEntry>,
  ): RestRecord {
    const record: RestRecord = { kind, at: asTimestamp(new Date()), entries }
    setParty({ ...getParty(campaignId), lastRest: record })
    return record
  }

  function lastRest(campaignId: CampaignId): RestRecord | null {
    return getParty(campaignId).lastRest
  }

  function activeCount(campaignId: CampaignId): number {
    return getParty(campaignId).members.filter((m) => m.status === 'active').length
  }

  function $reset(): void {
    state.value = { byCampaign: {} }
    persist(state.value)
  }

  return {
    getParty,
    setParty,
    addMember,
    removeMember,
    setStatus,
    setMotto,
    setSharedNotes,
    hitDiceFor,
    setHitDice,
    rememberRest,
    lastRest,
    activeCount,
    $reset,
  }
})
