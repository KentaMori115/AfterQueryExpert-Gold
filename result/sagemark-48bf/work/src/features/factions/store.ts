import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'

import type { CampaignId, CharacterId, FactionId } from '@core/ids'
import {
  type Faction,
  type FactionDraftInput,
} from '@core/models/faction'
import { FactionService } from '@core/services/faction-service'

export const useFactionStore = defineStore('factions', () => {
  const service = shallowRef(new FactionService())

  const all = ref<Faction[]>(service.value.list())

  function syncFromService(): void {
    all.value = service.value.list()
  }

  function forCampaign(campaignId: CampaignId): Faction[] {
    return all.value.filter((f) => f.campaignId === campaignId)
  }

  function activeFor(campaignId: CampaignId): Faction[] {
    return forCampaign(campaignId).filter((f) => f.active)
  }

  function byId(id: FactionId): Faction | null {
    return all.value.find((f) => f.id === id) ?? null
  }

  function create(draft: FactionDraftInput): Faction {
    const created = service.value.create(draft)
    syncFromService()
    return created
  }

  function update(id: FactionId, draft: FactionDraftInput): Faction {
    const updated = service.value.update(id, draft)
    syncFromService()
    return updated
  }

  function adjustInfluence(id: FactionId, delta: number): Faction {
    const next = service.value.adjustInfluence(id, delta)
    syncFromService()
    return next
  }

  function setActive(id: FactionId, active: boolean): Faction {
    const next = service.value.setActive(id, active)
    syncFromService()
    return next
  }

  function setLeader(id: FactionId, leaderId: CharacterId | null): Faction {
    const next = service.value.setLeader(id, leaderId)
    syncFromService()
    return next
  }

  function remove(id: FactionId): void {
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
    service.value = new FactionService()
    all.value = []
  }

  return {
    all,
    forCampaign,
    activeFor,
    byId,
    create,
    update,
    adjustInfluence,
    setActive,
    setLeader,
    remove,
    removeAllForCampaign,
    total,
    $reset,
  }
})
