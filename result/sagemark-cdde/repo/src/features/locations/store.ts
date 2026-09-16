import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'

import type { CampaignId, LocationId } from '@core/ids'
import {
  buildLocationTree,
  type Location,
  type LocationDraftInput,
  type LocationNode,
} from '@core/models/location'
import { LocationService } from '@core/services/location-service'

export const useLocationStore = defineStore('locations', () => {
  const service = shallowRef(new LocationService())

  const all = ref<Location[]>(service.value.list())

  function syncFromService(): void {
    all.value = service.value.list()
  }

  function forCampaign(campaignId: CampaignId): Location[] {
    return all.value.filter((l) => l.campaignId === campaignId)
  }

  function treeFor(campaignId: CampaignId): LocationNode[] {
    return buildLocationTree(forCampaign(campaignId))
  }

  function byId(id: LocationId): Location | null {
    return all.value.find((l) => l.id === id) ?? null
  }

  function create(draft: LocationDraftInput): Location {
    const created = service.value.create(draft)
    syncFromService()
    return created
  }

  function update(id: LocationId, draft: LocationDraftInput): Location {
    const updated = service.value.update(id, draft)
    syncFromService()
    return updated
  }

  function setVisited(id: LocationId, visited: boolean): Location {
    const next = service.value.setVisited(id, visited)
    syncFromService()
    return next
  }

  function setParent(id: LocationId, parentId: LocationId | null): Location {
    const next = service.value.setParent(id, parentId)
    syncFromService()
    return next
  }

  function remove(id: LocationId, cascade = false): void {
    service.value.delete(id, cascade)
    syncFromService()
  }

  function removeAllForCampaign(campaignId: CampaignId): number {
    const removed = service.value.removeAllForCampaign(campaignId)
    syncFromService()
    return removed
  }

  const total = computed(() => all.value.length)

  function $reset(): void {
    service.value = new LocationService()
    all.value = []
  }

  return {
    all,
    forCampaign,
    treeFor,
    byId,
    create,
    update,
    setVisited,
    setParent,
    remove,
    removeAllForCampaign,
    total,
    $reset,
  }
})
