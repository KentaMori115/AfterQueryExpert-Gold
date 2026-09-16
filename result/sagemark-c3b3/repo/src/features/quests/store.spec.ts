import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { asCampaignId } from '@core/ids'

import { useQuestStore } from './store'

describe('useQuestStore', () => {
  const camp = asCampaignId('camp_TEST123456')

  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('starts empty', () => {
    expect(useQuestStore().all).toEqual([])
  })

  it('creates and reads back', () => {
    const store = useQuestStore()
    const q = store.create({ campaignId: camp, title: 'X' })
    expect(store.byId(q.id)?.title).toBe('X')
  })

  it('openFor filters terminal', () => {
    const store = useQuestStore()
    store.create({ campaignId: camp, title: 'a' })
    store.create({ campaignId: camp, title: 'b', status: 'completed' })
    expect(store.openFor(camp)).toHaveLength(1)
  })

  it('setStatus moves quest', () => {
    const store = useQuestStore()
    const q = store.create({ campaignId: camp, title: 'X' })
    store.setStatus(q.id, 'accepted')
    expect(store.byId(q.id)?.status).toBe('accepted')
  })

  it('addObjective + toggle + remove', () => {
    const store = useQuestStore()
    const q = store.create({ campaignId: camp, title: 'X' })
    const u1 = store.addObjective(q.id, 'find the gate')
    const objId = u1.objectives[0]!.id
    store.toggleObjective(q.id, objId)
    expect(store.byId(q.id)?.objectives[0]?.completed).toBe(true)
    store.removeObjective(q.id, objId)
    expect(store.byId(q.id)?.objectives).toHaveLength(0)
  })

  it('remove drops the quest', () => {
    const store = useQuestStore()
    const q = store.create({ campaignId: camp, title: 'X' })
    store.remove(q.id)
    expect(store.byId(q.id)).toBe(null)
  })
})
