import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'

import type { CampaignId, NoteId } from '@core/ids'
import {
  type Note,
  type NoteDraftInput,
  type NotePriority,
  type NoteTarget,
  compareNotesForListing,
  isOverdue,
} from '@core/models/note'
import { NoteService } from '@core/services/note-service'

export const useNoteStore = defineStore('notes', () => {
  const service = shallowRef(new NoteService())

  const all = ref<Note[]>(service.value.list())

  function syncFromService(): void {
    all.value = service.value.list()
  }

  function forCampaign(campaignId: CampaignId): Note[] {
    return all.value.filter((n) => n.campaignId === campaignId)
  }

  function forTarget(campaignId: CampaignId, target: NoteTarget): Note[] {
    return forCampaign(campaignId).filter(
      (n) => n.target.kind === target.kind && n.target.id === target.id,
    )
  }

  function pinnedFor(campaignId: CampaignId): Note[] {
    return forCampaign(campaignId).filter((n) => n.pinned && n.resolvedAt === null)
  }

  function openFor(campaignId: CampaignId): Note[] {
    return forCampaign(campaignId).filter((n) => n.resolvedAt === null)
  }

  function overdueFor(campaignId: CampaignId, asOf: Date = new Date()): Note[] {
    return openFor(campaignId).filter((n) => isOverdue(n, asOf))
  }

  function listedFor(campaignId: CampaignId): Note[] {
    return [...forCampaign(campaignId)].sort(compareNotesForListing)
  }

  function byId(id: NoteId): Note | null {
    return all.value.find((n) => n.id === id) ?? null
  }

  function create(draft: NoteDraftInput): Note {
    const created = service.value.create(draft)
    syncFromService()
    return created
  }

  function update(id: NoteId, draft: NoteDraftInput): Note {
    const updated = service.value.update(id, draft)
    syncFromService()
    return updated
  }

  function setPriority(id: NoteId, priority: NotePriority): Note {
    const next = service.value.setPriority(id, priority)
    syncFromService()
    return next
  }

  function setPinned(id: NoteId, pinned: boolean): Note {
    const next = service.value.setPinned(id, pinned)
    syncFromService()
    return next
  }

  function resolve(id: NoteId): Note {
    const next = service.value.resolve(id)
    syncFromService()
    return next
  }

  function reopen(id: NoteId): Note {
    const next = service.value.reopen(id)
    syncFromService()
    return next
  }

  function remove(id: NoteId): void {
    service.value.delete(id)
    syncFromService()
  }

  function removeAllForCampaign(campaignId: CampaignId): number {
    const removed = service.value.removeAllForCampaign(campaignId)
    syncFromService()
    return removed
  }

  function removeAllForTarget(campaignId: CampaignId, target: NoteTarget): number {
    const removed = service.value.removeAllForTarget(campaignId, target)
    syncFromService()
    return removed
  }

  const total = computed(() => all.value.length)

  function $reset(): void {
    service.value = new NoteService()
    all.value = []
  }

  return {
    all,
    forCampaign,
    forTarget,
    pinnedFor,
    openFor,
    overdueFor,
    listedFor,
    byId,
    create,
    update,
    setPriority,
    setPinned,
    resolve,
    reopen,
    remove,
    removeAllForCampaign,
    removeAllForTarget,
    total,
    $reset,
  }
})
