import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'

import type { CampaignId, QuestId } from '@core/ids'
import {
  type Quest,
  type QuestDraftInput,
  type QuestStatus,
} from '@core/models/quest'
import { QuestService } from '@core/services/quest-service'

export const useQuestStore = defineStore('quests', () => {
  const service = shallowRef(new QuestService())

  const all = ref<Quest[]>(service.value.list())

  function syncFromService(): void {
    all.value = service.value.list()
  }

  function forCampaign(campaignId: CampaignId): Quest[] {
    return all.value.filter((q) => q.campaignId === campaignId)
  }

  function openFor(campaignId: CampaignId): Quest[] {
    return forCampaign(campaignId).filter(
      (q) => q.status !== 'completed' && q.status !== 'failed' && q.status !== 'abandoned',
    )
  }

  function byId(id: QuestId): Quest | null {
    return all.value.find((q) => q.id === id) ?? null
  }

  function create(draft: QuestDraftInput): Quest {
    const created = service.value.create(draft)
    syncFromService()
    return created
  }

  function update(id: QuestId, draft: QuestDraftInput): Quest {
    const updated = service.value.update(id, draft)
    syncFromService()
    return updated
  }

  function setStatus(id: QuestId, status: QuestStatus): Quest {
    const next = service.value.setStatus(id, status)
    syncFromService()
    return next
  }

  function addObjective(id: QuestId, text: string): Quest {
    const next = service.value.addObjective(id, text)
    syncFromService()
    return next
  }

  function toggleObjective(id: QuestId, objectiveId: string): Quest {
    const next = service.value.toggleObjective(id, objectiveId)
    syncFromService()
    return next
  }

  function removeObjective(id: QuestId, objectiveId: string): Quest {
    const next = service.value.removeObjective(id, objectiveId)
    syncFromService()
    return next
  }

  function remove(id: QuestId): void {
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
    service.value = new QuestService()
    all.value = []
  }

  return {
    all,
    forCampaign,
    openFor,
    byId,
    create,
    update,
    setStatus,
    addObjective,
    toggleObjective,
    removeObjective,
    remove,
    removeAllForCampaign,
    total,
    $reset,
  }
})
