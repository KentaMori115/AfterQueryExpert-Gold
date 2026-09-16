import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'

import type { CampaignId, FactionId } from '@core/ids'
import type { InfluenceSnapshot, SnapshotDraftInput } from '@core/models/influence-snapshot'
import { InfluenceService } from '@core/services/influence-service'

export const useInfluenceStore = defineStore('influence', () => {
  const service = shallowRef(new InfluenceService())
  const version = ref(0)

  function touch(): void {
    version.value++
  }

  function forFaction(factionId: FactionId): InfluenceSnapshot[] {
    void version.value
    return service.value.listForFaction(factionId)
  }

  function forCampaign(campaignId: CampaignId): InfluenceSnapshot[] {
    void version.value
    return service.value.listForCampaign(campaignId)
  }

  function record(draft: SnapshotDraftInput): InfluenceSnapshot {
    const next = service.value.record(draft)
    touch()
    return next
  }

  function remove(id: string): void {
    service.value.delete(id)
    touch()
  }

  function removeAllForFaction(factionId: FactionId): number {
    const removed = service.value.removeAllForFaction(factionId)
    touch()
    return removed
  }

  function removeAllForCampaign(campaignId: CampaignId): number {
    const removed = service.value.removeAllForCampaign(campaignId)
    touch()
    return removed
  }

  function $reset(): void {
    service.value = new InfluenceService()
    touch()
  }

  return {
    version,
    forFaction,
    forCampaign,
    record,
    remove,
    removeAllForFaction,
    removeAllForCampaign,
    $reset,
  }
})
