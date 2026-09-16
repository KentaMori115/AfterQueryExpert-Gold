import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import ItemsLedgerPage from './ItemsLedgerPage.vue'
import { useCampaignStore } from '@features/campaigns/store'
import { useCharacterStore } from '@features/characters/store'
import { useItemStore } from '../store'

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/campaigns', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/items', component: ItemsLedgerPage },
    ],
  })
}

describe('ItemsLedgerPage', () => {
  let router: Router

  beforeEach(async () => {
    setActivePinia(createPinia())
    window.localStorage.clear()
    router = makeRouter()
  })

  it('not-found when campaign missing', async () => {
    await router.push('/campaigns/camp_MISSING/items')
    await router.isReady()
    const w = mount(ItemsLedgerPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Campaign not found')
  })

  it('shows empty state', async () => {
    const c = useCampaignStore().create({ name: 'X' })
    await router.push(`/campaigns/${c.id}/items`)
    await router.isReady()
    const w = mount(ItemsLedgerPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Empty pockets')
  })

  it('adds an item', async () => {
    const c = useCampaignStore().create({ name: 'X' })
    const iStore = useItemStore()
    await router.push(`/campaigns/${c.id}/items`)
    await router.isReady()
    const w = mount(ItemsLedgerPage, { global: { plugins: [router] } })
    await w.get('#item-name').setValue('Frostbrand')
    await w.find('form').trigger('submit.prevent')
    await flushPromises()
    expect(iStore.forCampaign(c.id)).toHaveLength(1)
    expect(w.text()).toContain('Frostbrand')
  })

  it('totals the value in the header', async () => {
    const c = useCampaignStore().create({ name: 'X' })
    const iStore = useItemStore()
    iStore.create({ campaignId: c.id, name: 'a', valueGp: 100 })
    iStore.create({ campaignId: c.id, name: 'b', valueGp: 250 })
    await router.push(`/campaigns/${c.id}/items`)
    await router.isReady()
    const w = mount(ItemsLedgerPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('350 gp')
  })

  it('shows the unclaimed section when items have no owner', async () => {
    const c = useCampaignStore().create({ name: 'X' })
    const iStore = useItemStore()
    iStore.create({ campaignId: c.id, name: 'Sword' })
    await router.push(`/campaigns/${c.id}/items`)
    await router.isReady()
    const w = mount(ItemsLedgerPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Unclaimed')
    expect(w.text()).toContain('Sword')
  })

  it('rarity filter narrows the list to one rarity', async () => {
    const c = useCampaignStore().create({ name: 'X' })
    const iStore = useItemStore()
    iStore.create({ campaignId: c.id, name: 'Common A', rarity: 'common' })
    iStore.create({ campaignId: c.id, name: 'Rare B', rarity: 'rare' })
    await router.push(`/campaigns/${c.id}/items`)
    await router.isReady()
    const w = mount(ItemsLedgerPage, { global: { plugins: [router] } })
    await w.find('#rarity-filter').setValue('rare')
    expect(w.text()).toContain('Rare B')
    expect(w.text()).not.toContain('Common A')
  })

  it('sort by value puts the most expensive first', async () => {
    const c = useCampaignStore().create({ name: 'X' })
    const iStore = useItemStore()
    iStore.create({ campaignId: c.id, name: 'Cheap', valueGp: 10 })
    iStore.create({ campaignId: c.id, name: 'Pricey', valueGp: 5000 })
    await router.push(`/campaigns/${c.id}/items`)
    await router.isReady()
    const w = mount(ItemsLedgerPage, { global: { plugins: [router] } })
    await w.find('#sort-mode').setValue('value')
    const text = w.text()
    expect(text.indexOf('Pricey')).toBeLessThan(text.indexOf('Cheap'))
  })

  it('delete with confirm removes', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const c = useCampaignStore().create({ name: 'X' })
    const iStore = useItemStore()
    const i = iStore.create({ campaignId: c.id, name: 'X' })
    await router.push(`/campaigns/${c.id}/items`)
    await router.isReady()
    const w = mount(ItemsLedgerPage, { global: { plugins: [router] } })
    const remove = w.findAll('button').find((b) => b.text() === 'remove')
    await remove!.trigger('click')
    expect(iStore.byId(i.id)).toBe(null)
    confirmSpy.mockRestore()
  })
})
