import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'

import type { CampaignId, CharacterId } from '@core/ids'
import {
  type Character,
  type CharacterDisposition,
  type CharacterDraftInput,
  isPlayerCharacter,
} from '@core/models/character'
import { CharacterService } from '@core/services/character-service'

export const useCharacterStore = defineStore('characters', () => {
  const service = shallowRef(new CharacterService())

  const all = ref<Character[]>(service.value.list())

  function syncFromService(): void {
    all.value = service.value.list()
  }

  function forCampaign(campaignId: CampaignId): Character[] {
    return all.value.filter((c) => c.campaignId === campaignId)
  }

  function pcsFor(campaignId: CampaignId): Character[] {
    return forCampaign(campaignId).filter(isPlayerCharacter)
  }

  function npcsFor(campaignId: CampaignId): Character[] {
    return forCampaign(campaignId).filter((c) => !isPlayerCharacter(c))
  }

  function byId(id: CharacterId): Character | null {
    return all.value.find((c) => c.id === id) ?? null
  }

  function create(draft: CharacterDraftInput): Character {
    const created = service.value.create(draft)
    syncFromService()
    return created
  }

  function update(id: CharacterId, draft: CharacterDraftInput): Character {
    const updated = service.value.update(id, draft)
    syncFromService()
    return updated
  }

  function setDisposition(id: CharacterId, disposition: CharacterDisposition): Character {
    const next = service.value.setDisposition(id, disposition)
    syncFromService()
    return next
  }

  function markDeceased(id: CharacterId): Character {
    const next = service.value.markDeceased(id)
    syncFromService()
    return next
  }

  function revive(id: CharacterId): Character {
    const next = service.value.revive(id)
    syncFromService()
    return next
  }

  function remove(id: CharacterId): void {
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
    service.value = new CharacterService()
    all.value = []
  }

  return {
    all,
    forCampaign,
    pcsFor,
    npcsFor,
    byId,
    create,
    update,
    setDisposition,
    markDeceased,
    revive,
    remove,
    removeAllForCampaign,
    total,
    $reset,
  }
})
