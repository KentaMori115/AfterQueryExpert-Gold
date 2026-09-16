import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'

import type { CampaignId, CharacterId, SessionId } from '@core/ids'
import {
  type Session,
  type SessionDraftInput,
  sortChronologically,
} from '@core/models/session'
import { SessionService } from '@core/services/session-service'

export const useSessionStore = defineStore('sessions', () => {
  const service = shallowRef(new SessionService())

  const all = ref<Session[]>(service.value.list())

  function syncFromService(): void {
    all.value = service.value.list()
  }

  function forCampaign(campaignId: CampaignId): Session[] {
    return all.value.filter((s) => s.campaignId === campaignId)
  }

  function chronologicalFor(campaignId: CampaignId): Session[] {
    return sortChronologically(forCampaign(campaignId))
  }

  function latestFor(campaignId: CampaignId, limit = 5): Session[] {
    return service.value.latestForCampaign(campaignId, limit)
  }

  function byId(id: SessionId): Session | null {
    return all.value.find((s) => s.id === id) ?? null
  }

  function create(draft: SessionDraftInput): Session {
    const created = service.value.create(draft)
    syncFromService()
    return created
  }

  function update(id: SessionId, draft: SessionDraftInput): Session {
    const updated = service.value.update(id, draft)
    syncFromService()
    return updated
  }

  function setAttendance(id: SessionId, characterId: CharacterId, present: boolean): Session {
    const next = service.value.setAttendance(id, characterId, present)
    syncFromService()
    return next
  }

  function updateLog(id: SessionId, log: string): Session {
    const next = service.value.updateLog(id, log)
    syncFromService()
    return next
  }

  function remove(id: SessionId): void {
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
    service.value = new SessionService()
    all.value = []
  }

  return {
    all,
    forCampaign,
    chronologicalFor,
    latestFor,
    byId,
    create,
    update,
    setAttendance,
    updateLog,
    remove,
    removeAllForCampaign,
    total,
    $reset,
  }
})
