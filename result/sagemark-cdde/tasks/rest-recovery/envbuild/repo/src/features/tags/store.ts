import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'

import type { CampaignId, TagId } from '@core/ids'
import {
  type Tag,
  type TagDraft,
  type TagTargetKind,
  type TagTone,
  compareTagsForListing,
} from '@core/models/tag'
import { TagService } from '@core/services/tag-service'

export const useTagStore = defineStore('tags', () => {
  const service = shallowRef(new TagService())

  const all = ref<Tag[]>(service.value.list())

  function syncFromService(): void {
    all.value = service.value.list()
  }

  function forCampaign(campaignId: CampaignId): Tag[] {
    return [...all.value].filter((t) => t.campaignId === campaignId).sort(compareTagsForListing)
  }

  function forTarget(campaignId: CampaignId, kind: TagTargetKind, id: string): Tag[] {
    return forCampaign(campaignId).filter((t) =>
      t.appliedTo.some((a) => a.kind === kind && a.id === id),
    )
  }

  function byId(id: TagId): Tag | null {
    return all.value.find((t) => t.id === id) ?? null
  }

  function create(draft: TagDraft): Tag {
    const created = service.value.create(draft)
    syncFromService()
    return created
  }

  function rename(id: TagId, name: string): Tag {
    const updated = service.value.rename(id, name)
    syncFromService()
    return updated
  }

  function setTone(id: TagId, tone: TagTone): Tag {
    const updated = service.value.setTone(id, tone)
    syncFromService()
    return updated
  }

  function setDescription(id: TagId, description: string): Tag {
    const updated = service.value.setDescription(id, description)
    syncFromService()
    return updated
  }

  function attach(id: TagId, kind: TagTargetKind, targetId: string): Tag {
    const updated = service.value.attach(id, kind, targetId)
    syncFromService()
    return updated
  }

  function detach(id: TagId, kind: TagTargetKind, targetId: string): Tag {
    const updated = service.value.detach(id, kind, targetId)
    syncFromService()
    return updated
  }

  function detachTarget(campaignId: CampaignId, kind: TagTargetKind, targetId: string): number {
    const removed = service.value.detachTarget(campaignId, kind, targetId)
    syncFromService()
    return removed
  }

  function remove(id: TagId): void {
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
    service.value = new TagService()
    all.value = []
  }

  return {
    all,
    forCampaign,
    forTarget,
    byId,
    create,
    rename,
    setTone,
    setDescription,
    attach,
    detach,
    detachTarget,
    remove,
    removeAllForCampaign,
    total,
    $reset,
  }
})
