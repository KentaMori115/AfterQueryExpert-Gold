import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'

import type { CampaignId } from '@core/ids'
import {
  type Campaign,
  type CampaignDraftInput,
  type CampaignStatus,
  comparableSortKey,
  isOpen,
} from '@core/models/campaign'
import { CampaignService } from '@core/services/campaign-service'

export const useCampaignStore = defineStore('campaigns', () => {
  const service = shallowRef(new CampaignService())

  const all = ref<Campaign[]>(service.value.list())
  const activeId = ref<CampaignId | null>(restoreActiveId())

  function syncFromService(): void {
    all.value = service.value.list()
  }

  function setActive(id: CampaignId | null): void {
    if (id !== null && !service.value.tryGet(id)) return
    activeId.value = id
    persistActiveId(id)
  }

  function create(draft: CampaignDraftInput): Campaign {
    const created = service.value.create(draft)
    syncFromService()
    if (!activeId.value) setActive(created.id)
    return created
  }

  function update(id: CampaignId, draft: CampaignDraftInput): Campaign {
    const updated = service.value.update(id, draft)
    syncFromService()
    return updated
  }

  function setStatus(id: CampaignId, status: CampaignStatus): Campaign {
    const moved = service.value.setStatus(id, status)
    syncFromService()
    return moved
  }

  function remove(id: CampaignId): void {
    service.value.delete(id)
    if (activeId.value === id) setActive(null)
    syncFromService()
  }

  function recordSession(id: CampaignId, playedAt?: string | Date): Campaign {
    const updated = service.value.recordSessionPlayed(id, playedAt ?? new Date())
    syncFromService()
    return updated
  }

  const active = computed<Campaign | null>(() => {
    if (!activeId.value) return null
    return service.value.tryGet(activeId.value)
  })

  const sorted = computed<Campaign[]>(() =>
    [...all.value].sort((a, b) => comparableSortKey(a).localeCompare(comparableSortKey(b))),
  )

  const open = computed<Campaign[]>(() => sorted.value.filter(isOpen))
  const archived = computed<Campaign[]>(() => sorted.value.filter((c) => !isOpen(c)))

  const isEmpty = computed(() => all.value.length === 0)

  function $reset(): void {
    service.value = new CampaignService()
    all.value = []
    activeId.value = null
    persistActiveId(null)
  }

  return {
    all,
    activeId,
    setActive,
    create,
    update,
    setStatus,
    remove,
    recordSession,
    active,
    sorted,
    open,
    archived,
    isEmpty,
    $reset,
  }
})

const ACTIVE_KEY = 'sagemark:campaigns:active'

function persistActiveId(id: CampaignId | null): void {
  if (typeof window === 'undefined') return
  try {
    if (id === null) window.localStorage.removeItem(ACTIVE_KEY)
    else window.localStorage.setItem(ACTIVE_KEY, id)
  } catch {
    // localStorage is best-effort here
  }
}

function restoreActiveId(): CampaignId | null {
  if (typeof window === 'undefined') return null
  try {
    const value = window.localStorage.getItem(ACTIVE_KEY)
    return value ? (value as CampaignId) : null
  } catch {
    return null
  }
}
