import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'

import type { CampaignId, EncounterId, SessionId } from '@core/ids'
import {
  type Encounter,
  type EncounterDraftInput,
  type InitiativeEntry,
} from '@core/models/encounter'
import { EncounterService } from '@core/services/encounter-service'

export const useEncounterStore = defineStore('encounters', () => {
  const service = shallowRef(new EncounterService())

  const all = ref<Encounter[]>(service.value.list())

  function syncFromService(): void {
    all.value = service.value.list()
  }

  function forCampaign(campaignId: CampaignId): Encounter[] {
    return all.value.filter((e) => e.campaignId === campaignId)
  }

  function unresolvedFor(campaignId: CampaignId): Encounter[] {
    return forCampaign(campaignId).filter((e) => !e.resolved)
  }

  function forSession(sessionId: SessionId): Encounter[] {
    return all.value.filter((e) => e.sessionId === sessionId)
  }

  function byId(id: EncounterId): Encounter | null {
    return all.value.find((e) => e.id === id) ?? null
  }

  function create(draft: EncounterDraftInput): Encounter {
    const created = service.value.create(draft)
    syncFromService()
    return created
  }

  function update(id: EncounterId, draft: EncounterDraftInput): Encounter {
    const updated = service.value.update(id, draft)
    syncFromService()
    return updated
  }

  function setInitiative(id: EncounterId, entries: ReadonlyArray<InitiativeEntry>): Encounter {
    const next = service.value.setInitiative(id, entries)
    syncFromService()
    return next
  }

  function markResolved(id: EncounterId, resolved = true): Encounter {
    const next = service.value.markResolved(id, resolved)
    syncFromService()
    return next
  }

  function remove(id: EncounterId): void {
    service.value.delete(id)
    syncFromService()
  }

  function removeAllForCampaign(campaignId: CampaignId): number {
    const removed = service.value.removeAllForCampaign(campaignId)
    syncFromService()
    return removed
  }

  const total = computed(() => all.value.length)

  function $reset(): void {
    service.value = new EncounterService()
    all.value = []
  }

  return {
    all,
    forCampaign,
    unresolvedFor,
    forSession,
    byId,
    create,
    update,
    setInitiative,
    markResolved,
    remove,
    removeAllForCampaign,
    total,
    $reset,
  }
})
