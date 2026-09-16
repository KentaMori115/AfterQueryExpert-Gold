import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import { useRuleSnippetStore } from '../store'

import RulesPage from './RulesPage.vue'

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/rules', component: RulesPage },
    ],
  })
}

async function mountAt() {
  const router = makeRouter()
  await router.push('/rules')
  await router.isReady()
  return mount(RulesPage, { global: { plugins: [router] } })
}

describe('RulesPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('renders the empty state when no snippets exist', async () => {
    const w = await mountAt()
    expect(w.text()).toContain('No snippets here')
  })

  it('adds a snippet through the form', async () => {
    const w = await mountAt()
    await w.find('#rs-title').setValue('Cover')
    await w.find('textarea').setValue('half cover gives 2')
    await w.find('form').trigger('submit.prevent')
    expect(useRuleSnippetStore().all).toHaveLength(1)
    expect(w.text()).toContain('Cover')
  })

  it('filter chips narrow the list', async () => {
    const store = useRuleSnippetStore()
    store.create({ title: 'C', scope: 'combat', body: 'c' })
    store.create({ title: 'M', scope: 'magic', body: 'm' })
    const w = await mountAt()
    const magic = w.findAll('button').find((b) => b.text() === 'Magic')
    await magic!.trigger('click')
    expect(w.text()).toContain('M')
    expect(w.text()).not.toMatch(/^C\b/)
  })

  it('togglePin via the pin button', async () => {
    const store = useRuleSnippetStore()
    const a = store.create({ title: 'A', scope: 'combat', body: 'a' })
    const w = await mountAt()
    const pin = w.findAll('button').find((b) => b.text() === 'pin')
    await pin!.trigger('click')
    expect(store.byId(a.id)!.pinned).toBe(true)
  })
})
