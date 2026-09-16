import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import { useCampaignStore } from '@features/campaigns/store'

import { useTagStore } from '../store'

import TagsAdminPage from './TagsAdminPage.vue'

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/tags', component: TagsAdminPage },
    ],
  })
}

async function mountAt(campaignId: string) {
  const router = makeRouter()
  await router.push(`/campaigns/${campaignId}/tags`)
  await router.isReady()
  return mount(TagsAdminPage, { global: { plugins: [router] } })
}

describe('TagsAdminPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('shows a campaign-not-found message when the id has no campaign', async () => {
    const w = await mountAt('camp_missing')
    expect(w.text()).toContain('Campaign not found')
  })

  it('shows the empty state when the campaign has no tags', async () => {
    const campaigns = useCampaignStore()
    const c = campaigns.create({ name: 'Frostfall', summary: 'icy plains' })
    const w = await mountAt(c.id)
    expect(w.text()).toContain('No tags yet')
  })

  it('mints a new tag through the form', async () => {
    const campaigns = useCampaignStore()
    const c = campaigns.create({ name: 'Frostfall', summary: 'icy plains' })
    const w = await mountAt(c.id)
    const input = w.find('#tag-name')
    await input.setValue('Iron Banner')
    await w.find('form').trigger('submit.prevent')
    const tags = useTagStore()
    expect(tags.forCampaign(c.id as never)).toHaveLength(1)
    expect(w.text()).toContain('Iron Banner')
  })

  it('cycles the tone of an existing tag', async () => {
    const campaigns = useCampaignStore()
    const c = campaigns.create({ name: 'Frostfall', summary: 'icy plains' })
    const tags = useTagStore()
    const tag = tags.create({ campaignId: c.id as never, name: 'Iron', tone: 'parchment' })
    const w = await mountAt(c.id)
    const cycle = w.findAll('button').find((b) => b.text() === 'cycle tone')
    await cycle!.trigger('click')
    expect(tags.byId(tag.id)?.tone).not.toBe('parchment')
  })

  it('renames a tag through the inline editor', async () => {
    const campaigns = useCampaignStore()
    const c = campaigns.create({ name: 'Frostfall', summary: 'icy plains' })
    const tags = useTagStore()
    const tag = tags.create({ campaignId: c.id as never, name: 'Iron' })
    const w = await mountAt(c.id)
    const rename = w.findAll('button').find((b) => b.text() === 'rename')
    await rename!.trigger('click')
    const input = w.findAll('input').find((i) => (i.element as HTMLInputElement).value === 'Iron')
    await input!.setValue('Iron Circle')
    const save = w.findAll('button').find((b) => b.text() === 'save')
    await save!.trigger('click')
    expect(tags.byId(tag.id)?.slug).toBe('iron-circle')
  })

  it('reports the attached kind in plain prose', async () => {
    const campaigns = useCampaignStore()
    const c = campaigns.create({ name: 'Frostfall', summary: 'icy plains' })
    const tags = useTagStore()
    const tag = tags.create({ campaignId: c.id as never, name: 'Iron' })
    tags.attach(tag.id, 'character', 'char_1')
    const w = await mountAt(c.id)
    expect(w.text()).toContain('used on character')
  })
})
