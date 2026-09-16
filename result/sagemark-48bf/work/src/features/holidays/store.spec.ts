import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { asCampaignId } from '@core/ids/brand'

import { useHolidayStore } from './store'

const camp = asCampaignId('camp_X')

describe('useHolidayStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('creates a holiday and lists it under the campaign', () => {
    const store = useHolidayStore()
    store.create({ campaignId: camp, name: 'Frost Eve', month: 12, day: 31 })
    expect(store.forCampaign(camp)).toHaveLength(1)
    expect(store.total).toBe(1)
  })

  it('rejects bad drafts', () => {
    const store = useHolidayStore()
    expect(() => store.create({ campaignId: camp, name: '   ', month: 1, day: 1 })).toThrow()
  })

  it('upcoming returns events from the cursor onward then wraps', () => {
    const store = useHolidayStore()
    store.create({ campaignId: camp, name: 'Spring', month: 3, day: 15 })
    store.create({ campaignId: camp, name: 'Summer', month: 6, day: 21 })
    store.create({ campaignId: camp, name: 'Winter', month: 12, day: 31 })
    const result = store.upcoming(
      camp,
      { monthsPerYear: 12, daysPerMonth: 30 },
      { month: 7, day: 1 },
      2,
    )
    expect(result.map((h) => h.name)).toEqual(['Winter', 'Spring'])
  })

  it('update changes the date', () => {
    const store = useHolidayStore()
    const h = store.create({ campaignId: camp, name: 'Festival', month: 4, day: 1 })
    store.update(h.id, { campaignId: camp, name: 'Festival', month: 5, day: 1 })
    expect(store.byId(h.id)?.month).toBe(5)
  })

  it('remove drops it', () => {
    const store = useHolidayStore()
    const h = store.create({ campaignId: camp, name: 'F', month: 1, day: 1 })
    store.remove(h.id)
    expect(store.byId(h.id)).toBeNull()
  })

  it('persists across re-init', () => {
    const first = useHolidayStore()
    first.create({ campaignId: camp, name: 'Frost', month: 12, day: 1 })
    setActivePinia(createPinia())
    const second = useHolidayStore()
    expect(second.forCampaign(camp)).toHaveLength(1)
  })
})
