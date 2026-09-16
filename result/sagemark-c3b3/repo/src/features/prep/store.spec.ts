import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { asCampaignId, asSessionId } from '@core/ids/brand'

import { DEFAULT_PREP_TEMPLATE, usePrepStore } from './store'

const camp = asCampaignId('camp_X')
const sess = asSessionId('sess_X')

describe('usePrepStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('returns an empty checklist when none exists', () => {
    const store = usePrepStore()
    const list = store.checklist(camp, sess)
    expect(list.items).toEqual([])
    expect(list.campaignId).toBe(camp)
    expect(list.sessionId).toBe(sess)
  })

  it('addItem appends a new prep item', () => {
    const store = usePrepStore()
    const item = store.addItem(camp, sess, 'scene', 'opening scene with a question')
    expect(item.text).toBe('opening scene with a question')
    expect(item.done).toBe(false)
    expect(store.checklist(camp, sess).items).toHaveLength(1)
  })

  it('toggleItem flips done and tracks completedAt', () => {
    const store = usePrepStore()
    const item = store.addItem(camp, sess, 'scene', 'a scene')
    store.toggleItem(camp, sess, item.id)
    const after = store.checklist(camp, sess).items[0]!
    expect(after.done).toBe(true)
    expect(after.completedAt).toBeTruthy()
    store.toggleItem(camp, sess, item.id)
    const reset = store.checklist(camp, sess).items[0]!
    expect(reset.done).toBe(false)
    expect(reset.completedAt).toBeNull()
  })

  it('removeItem drops it from the list', () => {
    const store = usePrepStore()
    const item = store.addItem(camp, sess, 'reminder', 'reread the log')
    store.removeItem(camp, sess, item.id)
    expect(store.checklist(camp, sess).items).toHaveLength(0)
  })

  it('applyTemplate appends every item in the default template', () => {
    const store = usePrepStore()
    store.applyTemplate(camp, sess)
    expect(store.checklist(camp, sess).items).toHaveLength(DEFAULT_PREP_TEMPLATE.length)
  })

  it('clearList resets the items', () => {
    const store = usePrepStore()
    store.applyTemplate(camp, sess)
    expect(store.checklist(camp, sess).items.length).toBeGreaterThan(0)
    store.clearList(camp, sess)
    expect(store.checklist(camp, sess).items).toEqual([])
  })

  it('progress reports total, done and pct', () => {
    const store = usePrepStore()
    store.addItem(camp, sess, 'scene', 'a')
    const b = store.addItem(camp, sess, 'scene', 'b')
    store.toggleItem(camp, sess, b.id)
    const p = store.progress(camp, sess)
    expect(p.total).toBe(2)
    expect(p.done).toBe(1)
    expect(p.pct).toBe(50)
  })

  it('separates checklists by sessionId including the null next-session slot', () => {
    const store = usePrepStore()
    store.addItem(camp, sess, 'scene', 'session list')
    store.addItem(camp, null, 'scene', 'next session list')
    expect(store.checklist(camp, sess).items).toHaveLength(1)
    expect(store.checklist(camp, null).items).toHaveLength(1)
  })

  it('persists across re-init via the underlying KV store', () => {
    const first = usePrepStore()
    first.addItem(camp, sess, 'scene', 'persisted')
    setActivePinia(createPinia())
    const second = usePrepStore()
    expect(second.checklist(camp, sess).items.map((i) => i.text)).toEqual(['persisted'])
  })
})
