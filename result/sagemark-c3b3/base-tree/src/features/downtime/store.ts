import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'

import type { CampaignId, CharacterId } from '@core/ids'
import {
  type DowntimeActivity,
  type DowntimeDraft,
  type DowntimeOutcome,
  compareForListing,
} from '@core/models/downtime'
import { DowntimeService } from '@core/services/downtime-service'

export const useDowntimeStore = defineStore('downtime', () => {
  const service = shallowRef(new DowntimeService())
  const all = ref<DowntimeActivity[]>(service.value.list())

  function syncFromService(): void {
    all.value = service.value.list()
  }

  function forCampaign(campaignId: CampaignId): DowntimeActivity[] {
    return [...all.value]
      .filter((a) => a.campaignId === campaignId)
      .sort(compareForListing)
  }

  function forCharacter(campaignId: CampaignId, characterId: CharacterId): DowntimeActivity[] {
    return forCampaign(campaignId).filter((a) => a.characterId === characterId)
  }

  function byId(id: string): DowntimeActivity | null {
    return all.value.find((a) => a.id === id) ?? null
  }

  function create(draft: DowntimeDraft): DowntimeActivity {
    const created = service.value.create(draft)
    syncFromService()
    return created
  }

  function setOutcome(id: string, outcome: DowntimeOutcome): DowntimeActivity {
    const updated = service.value.setOutcome(id, outcome)
    syncFromService()
    return updated
  }

  function setWeeks(id: string, weeks: number): DowntimeActivity {
    const updated = service.value.setWeeks(id, weeks)
    syncFromService()
    return updated
  }

  function setDescription(id: string, description: string): DowntimeActivity {
    const updated = service.value.setDescription(id, description)
    syncFromService()
    return updated
  }

  function setReward(id: string, reward: string): DowntimeActivity {
    const updated = service.value.setReward(id, reward)
    syncFromService()
    return updated
  }

  function remove(id: string): void {
    service.value.delete(id)
    syncFromService()
  }

  function removeAllForCharacter(campaignId: CampaignId, characterId: CharacterId): number {
    const removed = service.value.removeAllForCharacter(campaignId, characterId)
    syncFromService()
    return removed
  }

  const total = computed(() => all.value.length)

  function $reset(): void {
    service.value = new DowntimeService()
    all.value = []
  }

  return {
    all,
    forCampaign,
    forCharacter,
    byId,
    create,
    setOutcome,
    setWeeks,
    setDescription,
    setReward,
    remove,
    removeAllForCharacter,
    total,
    $reset,
  }
})
