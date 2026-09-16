import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'

import type { CampaignId, CharacterId } from '@core/ids'
import type { XpEntry, XpEntryDraftInput } from '@core/models/xp-log'
import { XpService } from '@core/services/xp-service'

export const useXpStore = defineStore('xp', () => {
  const service = shallowRef(new XpService())

  // Reactivity bump so callers re render after mutations
  const version = ref(0)

  function touch(): void {
    version.value++
  }

  function forCampaign(campaignId: CampaignId): XpEntry[] {
    void version.value
    return service.value.listForCampaign(campaignId)
  }

  function forCharacter(characterId: CharacterId): XpEntry[] {
    void version.value
    return service.value.listForCharacter(characterId)
  }

  function totalFor(characterId: CharacterId): number {
    void version.value
    return service.value.totalFor(characterId)
  }

  function recordAward(draft: XpEntryDraftInput): XpEntry {
    const entry = service.value.recordAward(draft)
    touch()
    return entry
  }

  function recordDeduct(draft: XpEntryDraftInput): XpEntry {
    const entry = service.value.recordDeduct(draft)
    touch()
    return entry
  }

  function recordMilestone(draft: XpEntryDraftInput): XpEntry {
    const entry = service.value.recordMilestone(draft)
    touch()
    return entry
  }

  function remove(id: string): void {
    service.value.delete(id)
    touch()
  }

  function removeAllForCharacter(characterId: CharacterId): number {
    const removed = service.value.removeAllForCharacter(characterId)
    touch()
    return removed
  }

  function removeAllForCampaign(campaignId: CampaignId): number {
    const removed = service.value.removeAllForCampaign(campaignId)
    touch()
    return removed
  }

  function $reset(): void {
    service.value = new XpService()
    touch()
  }

  return {
    version,
    forCampaign,
    forCharacter,
    totalFor,
    recordAward,
    recordDeduct,
    recordMilestone,
    remove,
    removeAllForCharacter,
    removeAllForCampaign,
    $reset,
  }
})
