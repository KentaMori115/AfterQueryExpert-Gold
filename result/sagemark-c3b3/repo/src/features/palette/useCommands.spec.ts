import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import { useCampaignStore } from '@features/campaigns/store'
import { useCharacterStore } from '@features/characters/store'

import { useCommands, type PaletteCommand } from './useCommands'

const Harness = defineComponent({
  setup(_, { expose }) {
    const api = useCommands()
    expose({ search: api.search, commands: api.commands })
    return () => h('div')
  },
})

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:rest(.*)', component: { template: '<div />' } }],
  })
}

interface Exposed {
  search: (q: string) => PaletteCommand[]
  commands: { value: PaletteCommand[] }
}

describe('useCommands', () => {
  let router: Router

  beforeEach(async () => {
    setActivePinia(createPinia())
    window.localStorage.clear()
    router = makeRouter()
    await router.push('/')
    await router.isReady()
  })

  it('returns the navigation commands when there is no active campaign', () => {
    const w = mount(Harness, { global: { plugins: [router] } })
    const api = w.vm as unknown as Exposed
    const results = api.search('')
    expect(results.length).toBeGreaterThan(0)
    expect(results.some((c) => c.label.toLowerCase().includes('campaigns'))).toBe(true)
  })

  it('includes character commands when a campaign is active', () => {
    const camp = useCampaignStore().create({ name: 'X' })
    useCharacterStore().create({ campaignId: camp.id, name: 'Iris Thorne' })
    const w = mount(Harness, { global: { plugins: [router] } })
    const api = w.vm as unknown as Exposed
    const results = api.search('iris')
    expect(results.some((c) => c.kind === 'character' && c.label.includes('Iris'))).toBe(true)
  })

  it('search ranks label prefix matches above keyword matches', () => {
    const camp = useCampaignStore().create({ name: 'X' })
    useCharacterStore().create({ campaignId: camp.id, name: 'Frostbite' })
    const w = mount(Harness, { global: { plugins: [router] } })
    const api = w.vm as unknown as Exposed
    const results = api.search('frost')
    expect(results[0]?.label.toLowerCase()).toContain('frost')
  })

  it('search returns empty when nothing matches', () => {
    const w = mount(Harness, { global: { plugins: [router] } })
    const api = w.vm as unknown as Exposed
    expect(api.search('absolutelynothing12345')).toEqual([])
  })

  it('includes a Switch to entry per campaign', () => {
    const a = useCampaignStore().create({ name: 'Frozen Gate' })
    const b = useCampaignStore().create({ name: 'Sunward March' })
    const w = mount(Harness, { global: { plugins: [router] } })
    const api = w.vm as unknown as Exposed
    const results = api.search('switch')
    const labels = results.map((r) => r.label)
    expect(labels.some((l) => l.includes('Frozen Gate'))).toBe(true)
    expect(labels.some((l) => l.includes('Sunward March'))).toBe(true)
    void a
    void b
  })
})
