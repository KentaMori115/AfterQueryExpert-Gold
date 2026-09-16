import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'

import type { CampaignId, LoreId } from '@core/ids'
import {
  type LoreEntry,
  type LoreDraftInput,
} from '@core/models/lore'
import { LoreService } from '@core/services/lore-service'

export const useLoreStore = defineStore('lore', () => {
  const service = shallowRef(new LoreService())

  const all = ref<LoreEntry[]>(service.value.list())

  function syncFromService(): void {
    all.value = service.value.list()
  }

  function forCampaign(campaignId: CampaignId): LoreEntry[] {
    return all.value.filter((l) => l.campaignId === campaignId)
  }

  function search(campaignId: CampaignId, query: string): LoreEntry[] {
    return service.value.searchFor(campaignId, query)
  }

  function uniqueTagsFor(campaignId: CampaignId): string[] {
    return service.value.uniqueTagsFor(campaignId)
  }

  function byId(id: LoreId): LoreEntry | null {
    return all.value.find((l) => l.id === id) ?? null
  }

  function create(draft: LoreDraftInput): LoreEntry {
    const created = service.value.create(draft)
    syncFromService()
    return created
  }

  function update(id: LoreId, draft: LoreDraftInput): LoreEntry {
    const updated = service.value.update(id, draft)
    syncFromService()
    return updated
  }

  function setRevealed(id: LoreId, revealed: boolean): LoreEntry {
    const next = service.value.setRevealed(id, revealed)
    syncFromService()
    return next
  }

  function setPinned(id: LoreId, pinned: boolean): LoreEntry {
    const next = service.value.setPinned(id, pinned)
    syncFromService()
    return next
  }

  function remove(id: LoreId): void {
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
    service.value = new LoreService()
    all.value = []
  }

  return {
    all,
    forCampaign,
    search,
    uniqueTagsFor,
    byId,
    create,
    update,
    setRevealed,
    setPinned,
    remove,
    removeAllForCampaign,
    total,
    $reset,
  }
})
