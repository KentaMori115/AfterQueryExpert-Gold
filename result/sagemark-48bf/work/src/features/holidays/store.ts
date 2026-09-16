import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'

import type { CampaignId } from '@core/ids'
import { type Holiday, type HolidayDraft, compareByDate, nextUpcoming } from '@core/models/holiday'
import { HolidayService } from '@core/services/holiday-service'

export const useHolidayStore = defineStore('holidays', () => {
  const service = shallowRef(new HolidayService())
  const all = ref<Holiday[]>(service.value.list())

  function syncFromService(): void {
    all.value = service.value.list()
  }

  function forCampaign(campaignId: CampaignId): Holiday[] {
    return [...all.value].filter((h) => h.campaignId === campaignId).sort(compareByDate)
  }

  function upcoming(
    campaignId: CampaignId,
    shape: { monthsPerYear: number; daysPerMonth: number },
    from: { month: number; day: number },
    count = 3,
  ): Holiday[] {
    return nextUpcoming(forCampaign(campaignId), shape, from, count)
  }

  function byId(id: string): Holiday | null {
    return all.value.find((h) => h.id === id) ?? null
  }

  function create(draft: HolidayDraft): Holiday {
    const created = service.value.create(draft)
    syncFromService()
    return created
  }

  function update(id: string, draft: HolidayDraft): Holiday {
    const updated = service.value.update(id, draft)
    syncFromService()
    return updated
  }

  function remove(id: string): void {
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
    service.value = new HolidayService()
    all.value = []
  }

  return {
    all,
    forCampaign,
    upcoming,
    byId,
    create,
    update,
    remove,
    removeAllForCampaign,
    total,
    $reset,
  }
})
