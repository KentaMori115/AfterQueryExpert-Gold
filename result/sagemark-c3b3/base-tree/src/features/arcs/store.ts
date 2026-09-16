import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'

import type { ArcId, CampaignId } from '@core/ids'
import {
  ARC_STATUSES,
  type Arc,
  type ArcDraftInput,
  type ArcStatus,
  type ArcTension,
} from '@core/models/arc'
import { ArcService } from '@core/services/arc-service'

export const useArcStore = defineStore('arcs', () => {
  const service = shallowRef(new ArcService())

  const all = ref<Arc[]>(service.value.list())

  function syncFromService(): void {
    all.value = service.value.list()
  }

  function forCampaign(campaignId: CampaignId): Arc[] {
    return all.value.filter((a) => a.campaignId === campaignId)
  }

  function groupedByStatus(campaignId: CampaignId): Record<ArcStatus, Arc[]> {
    const out = {} as Record<ArcStatus, Arc[]>
    for (const s of ARC_STATUSES) out[s] = []
    for (const a of forCampaign(campaignId)) {
      out[a.status].push(a)
    }
    return out
  }

  function liveCountFor(campaignId: CampaignId): number {
    return forCampaign(campaignId).filter((a) => a.status !== 'resolved' && a.status !== 'shelved').length
  }

  function byId(id: ArcId): Arc | null {
    return all.value.find((a) => a.id === id) ?? null
  }

  function create(draft: ArcDraftInput): Arc {
    const created = service.value.create(draft)
    syncFromService()
    return created
  }

  function update(id: ArcId, draft: ArcDraftInput): Arc {
    const updated = service.value.update(id, draft)
    syncFromService()
    return updated
  }

  function setStatus(id: ArcId, status: ArcStatus): Arc {
    const next = service.value.setStatus(id, status)
    syncFromService()
    return next
  }

  function setTension(id: ArcId, tension: ArcTension): Arc {
    const next = service.value.setTension(id, tension)
    syncFromService()
    return next
  }

  function remove(id: ArcId): void {
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
    service.value = new ArcService()
    all.value = []
  }

  return {
    all,
    forCampaign,
    groupedByStatus,
    liveCountFor,
    byId,
    create,
    update,
    setStatus,
    setTension,
    remove,
    removeAllForCampaign,
    total,
    $reset,
  }
})
