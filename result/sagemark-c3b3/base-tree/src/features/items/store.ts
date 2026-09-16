import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'

import type { CampaignId, CharacterId, ItemId } from '@core/ids'
import { type Item, type ItemDraftInput } from '@core/models/item'
import { ItemService } from '@core/services/item-service'

export const useItemStore = defineStore('items', () => {
  const service = shallowRef(new ItemService())

  const all = ref<Item[]>(service.value.list())

  function syncFromService(): void {
    all.value = service.value.list()
  }

  function forCampaign(campaignId: CampaignId): Item[] {
    return all.value.filter((i) => i.campaignId === campaignId)
  }

  function unownedFor(campaignId: CampaignId): Item[] {
    return forCampaign(campaignId).filter((i) => i.ownerId === null)
  }

  function ownedBy(ownerId: CharacterId): Item[] {
    return all.value.filter((i) => i.ownerId === ownerId)
  }

  function totalValueFor(campaignId: CampaignId): number {
    return forCampaign(campaignId).reduce((sum, i) => sum + (i.valueGp || 0), 0)
  }

  function byId(id: ItemId): Item | null {
    return all.value.find((i) => i.id === id) ?? null
  }

  function create(draft: ItemDraftInput): Item {
    const created = service.value.create(draft)
    syncFromService()
    return created
  }

  function update(id: ItemId, draft: ItemDraftInput): Item {
    const updated = service.value.update(id, draft)
    syncFromService()
    return updated
  }

  function giveTo(id: ItemId, ownerId: CharacterId | null): Item {
    const next = service.value.giveTo(id, ownerId)
    syncFromService()
    return next
  }

  function setAttuned(id: ItemId, attuned: boolean): Item {
    const next = service.value.setAttuned(id, attuned)
    syncFromService()
    return next
  }

  function remove(id: ItemId): void {
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
    service.value = new ItemService()
    all.value = []
  }

  return {
    all,
    forCampaign,
    unownedFor,
    ownedBy,
    totalValueFor,
    byId,
    create,
    update,
    giveTo,
    setAttuned,
    remove,
    removeAllForCampaign,
    total,
    $reset,
  }
})
