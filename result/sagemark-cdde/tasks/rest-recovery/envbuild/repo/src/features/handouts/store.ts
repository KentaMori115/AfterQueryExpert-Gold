import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'

import type { CampaignId } from '@core/ids'
import type {
  Handout,
  HandoutDraftInput,
  HandoutVisibility,
} from '@core/models/handout'
import { HandoutService } from '@core/services/handout-service'

export const useHandoutStore = defineStore('handouts', () => {
  const service = shallowRef(new HandoutService())
  const version = ref(0)

  function touch(): void {
    version.value++
  }

  function forCampaign(campaignId: CampaignId): Handout[] {
    void version.value
    return service.value.listForCampaign(campaignId)
  }

  function byVisibility(campaignId: CampaignId, visibility: HandoutVisibility): Handout[] {
    void version.value
    return service.value.byVisibility(campaignId, visibility)
  }

  function forRecipient(campaignId: CampaignId, recipient: string): Handout[] {
    void version.value
    return service.value.forRecipient(campaignId, recipient)
  }

  function byId(id: string): Handout | null {
    void version.value
    return service.value.tryGet(id)
  }

  function create(draft: HandoutDraftInput): Handout {
    const next = service.value.create(draft)
    touch()
    return next
  }

  function update(id: string, draft: HandoutDraftInput): Handout {
    const next = service.value.update(id, draft)
    touch()
    return next
  }

  function share(id: string): Handout {
    const next = service.value.share(id)
    touch()
    return next
  }

  function unshare(id: string): Handout {
    const next = service.value.unshare(id)
    touch()
    return next
  }

  function archive(id: string): Handout {
    const next = service.value.archive(id)
    touch()
    return next
  }

  function addRecipient(id: string, name: string): Handout {
    const next = service.value.addRecipient(id, name)
    touch()
    return next
  }

  function removeRecipient(id: string, name: string): Handout {
    const next = service.value.removeRecipient(id, name)
    touch()
    return next
  }

  function remove(id: string): void {
    service.value.delete(id)
    touch()
  }

  function removeAllForCampaign(campaignId: CampaignId): number {
    const removed = service.value.removeAllForCampaign(campaignId)
    touch()
    return removed
  }

  function $reset(): void {
    service.value = new HandoutService()
    touch()
  }

  return {
    version,
    forCampaign,
    byVisibility,
    forRecipient,
    byId,
    create,
    update,
    share,
    unshare,
    archive,
    addRecipient,
    removeRecipient,
    remove,
    removeAllForCampaign,
    $reset,
  }
})
