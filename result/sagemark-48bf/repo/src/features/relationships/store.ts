import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'

import type { CampaignId, RelationshipId } from '@core/ids'
import {
  type Relationship,
  type RelationshipDraftInput,
  type RelationshipEndpoint,
} from '@core/models/relationship'
import { RelationshipService } from '@core/services/relationship-service'

export const useRelationshipStore = defineStore('relationships', () => {
  const service = shallowRef(new RelationshipService())

  const all = ref<Relationship[]>(service.value.list())

  function syncFromService(): void {
    all.value = service.value.list()
  }

  function forCampaign(campaignId: CampaignId): Relationship[] {
    return all.value.filter((r) => r.campaignId === campaignId)
  }

  function forNode(campaignId: CampaignId, node: RelationshipEndpoint): Relationship[] {
    return service.value.forNode(campaignId, node)
  }

  function byId(id: RelationshipId): Relationship | null {
    return all.value.find((r) => r.id === id) ?? null
  }

  function create(draft: RelationshipDraftInput): Relationship {
    const created = service.value.create(draft)
    syncFromService()
    return created
  }

  function update(id: RelationshipId, draft: RelationshipDraftInput): Relationship {
    const updated = service.value.update(id, draft)
    syncFromService()
    return updated
  }

  function remove(id: RelationshipId): void {
    service.value.delete(id)
    syncFromService()
  }

  function removeAllForCampaign(campaignId: CampaignId): number {
    const removed = service.value.removeAllForCampaign(campaignId)
    syncFromService()
    return removed
  }

  function removeAllInvolving(campaignId: CampaignId, node: RelationshipEndpoint): number {
    const removed = service.value.removeAllInvolving(campaignId, node)
    syncFromService()
    return removed
  }

  const total = computed(() => all.value.length)

  function $reset(): void {
    service.value = new RelationshipService()
    all.value = []
  }

  return {
    all,
    forCampaign,
    forNode,
    byId,
    create,
    update,
    remove,
    removeAllForCampaign,
    removeAllInvolving,
    total,
    $reset,
  }
})
