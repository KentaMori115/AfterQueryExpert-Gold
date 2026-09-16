import { setActivePinia, createPinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useCampaignStore } from './store'

describe('useCampaignStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('starts empty when storage is empty', () => {
    const store = useCampaignStore()
    expect(store.all).toEqual([])
    expect(store.isEmpty).toBe(true)
    expect(store.active).toBe(null)
  })

  it('creates a campaign and adds it to all', () => {
    const store = useCampaignStore()
    const c = store.create({ name: 'Test Run' })
    expect(store.all).toHaveLength(1)
    expect(store.all[0]?.id).toBe(c.id)
  })

  it('auto-activates the first created campaign', () => {
    const store = useCampaignStore()
    const c = store.create({ name: 'First' })
    expect(store.activeId).toBe(c.id)
    expect(store.active?.name).toBe('First')
  })

  it('does not re-activate when one is already active', () => {
    const store = useCampaignStore()
    const a = store.create({ name: 'A' })
    const b = store.create({ name: 'B' })
    expect(store.activeId).toBe(a.id)
    expect(b.id).not.toBe(a.id)
  })

  it('setActive switches the active campaign', () => {
    const store = useCampaignStore()
    const a = store.create({ name: 'A' })
    const b = store.create({ name: 'B' })
    store.setActive(b.id)
    expect(store.active?.id).toBe(b.id)
    store.setActive(a.id)
    expect(store.active?.id).toBe(a.id)
  })

  it('setActive ignores unknown ids', () => {
    const store = useCampaignStore()
    const a = store.create({ name: 'A' })
    store.setActive('camp_NOPE000000' as never)
    expect(store.active?.id).toBe(a.id)
  })

  it('persists the active id across reset/re-init', () => {
    const store = useCampaignStore()
    const a = store.create({ name: 'A' })
    expect(window.localStorage.getItem('sagemark:campaigns:active')).toBe(a.id)
  })

  it('update mutates fields', () => {
    const store = useCampaignStore()
    const c = store.create({ name: 'Old' })
    store.update(c.id, { name: 'New' })
    expect(store.all.find((x) => x.id === c.id)?.name).toBe('New')
  })

  it('setStatus changes status', () => {
    const store = useCampaignStore()
    const c = store.create({ name: 'X' })
    store.setStatus(c.id, 'archived')
    expect(store.all.find((x) => x.id === c.id)?.status).toBe('archived')
  })

  it('open / archived partition correctly', () => {
    const store = useCampaignStore()
    const a = store.create({ name: 'Open one', status: 'active' })
    const b = store.create({ name: 'Archived one', status: 'archived' })
    expect(store.open.map((c) => c.id)).toContain(a.id)
    expect(store.archived.map((c) => c.id)).toContain(b.id)
    expect(store.open.map((c) => c.id)).not.toContain(b.id)
  })

  it('remove drops the campaign and clears active if it was active', () => {
    const store = useCampaignStore()
    const c = store.create({ name: 'X' })
    store.remove(c.id)
    expect(store.all).toHaveLength(0)
    expect(store.activeId).toBe(null)
  })

  it('recordSession increments session count', () => {
    const store = useCampaignStore()
    const c = store.create({ name: 'X' })
    store.recordSession(c.id, '2025-04-01T20:00:00Z')
    expect(store.all.find((x) => x.id === c.id)?.sessionCount).toBe(1)
  })

  it('sorted puts open campaigns before archived', () => {
    const store = useCampaignStore()
    const archived = store.create({ name: 'arch', status: 'archived' })
    const open = store.create({ name: 'op', status: 'active' })
    const order = store.sorted.map((c) => c.id)
    expect(order.indexOf(open.id)).toBeLessThan(order.indexOf(archived.id))
  })
})
