import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'

import type { CampaignId, TimelineEventId } from '@core/ids'
import {
  type TimelineDraftInput,
  type TimelineEvent,
  sortChronologically,
} from '@core/models/timeline'
import { TimelineService } from '@core/services/timeline-service'

export const useTimelineStore = defineStore('timeline', () => {
  const service = shallowRef(new TimelineService())

  const all = ref<TimelineEvent[]>(service.value.list())

  function syncFromService(): void {
    all.value = service.value.list()
  }

  function forCampaign(campaignId: CampaignId): TimelineEvent[] {
    return all.value.filter((e) => e.campaignId === campaignId)
  }

  function chronologicalFor(campaignId: CampaignId): TimelineEvent[] {
    return sortChronologically(forCampaign(campaignId))
  }

  function byId(id: TimelineEventId): TimelineEvent | null {
    return all.value.find((e) => e.id === id) ?? null
  }

  function create(draft: TimelineDraftInput): TimelineEvent {
    const created = service.value.create(draft)
    syncFromService()
    return created
  }

  function update(id: TimelineEventId, draft: TimelineDraftInput): TimelineEvent {
    const updated = service.value.update(id, draft)
    syncFromService()
    return updated
  }

  function setRevealed(id: TimelineEventId, revealed: boolean): TimelineEvent {
    const next = service.value.setRevealed(id, revealed)
    syncFromService()
    return next
  }

  function remove(id: TimelineEventId): void {
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
    service.value = new TimelineService()
    all.value = []
  }

  return {
    all,
    forCampaign,
    chronologicalFor,
    byId,
    create,
    update,
    setRevealed,
    remove,
    removeAllForCampaign,
    total,
    $reset,
  }
})
