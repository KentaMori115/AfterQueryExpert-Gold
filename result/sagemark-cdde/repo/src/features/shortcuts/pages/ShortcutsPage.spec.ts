import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import ShortcutsPage from './ShortcutsPage.vue'

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/shortcuts', component: ShortcutsPage },
    ],
  })
}

describe('ShortcutsPage', () => {
  it('renders the title and tagline', async () => {
    const router = makeRouter()
    await router.push('/shortcuts')
    await router.isReady()
    const w = mount(ShortcutsPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Keyboard shortcuts')
    expect(w.text()).toContain('fastest way around')
  })

  it('groups shortcuts under section titles', async () => {
    const router = makeRouter()
    await router.push('/shortcuts')
    await router.isReady()
    const w = mount(ShortcutsPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Navigation')
    expect(w.text()).toContain('Editing')
    expect(w.text()).toContain('Palette controls')
  })

  it('renders each shortcut combo inside a kbd element', async () => {
    const router = makeRouter()
    await router.push('/shortcuts')
    await router.isReady()
    const w = mount(ShortcutsPage, { global: { plugins: [router] } })
    const kbds = w.findAll('kbd')
    expect(kbds.length).toBeGreaterThanOrEqual(8)
    const joined = kbds.map((k) => k.text()).join(' ')
    expect(joined).toContain('K')
    expect(joined).toContain('Esc')
    expect(joined).toContain('↵')
  })

  it('lists the navigation descriptions', async () => {
    const router = makeRouter()
    await router.push('/shortcuts')
    await router.isReady()
    const w = mount(ShortcutsPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Open the command palette')
    expect(w.text()).toContain('Open the dice roller from anywhere')
  })

  it('shows the home breadcrumb', async () => {
    const router = makeRouter()
    await router.push('/shortcuts')
    await router.isReady()
    const w = mount(ShortcutsPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Home')
    expect(w.text()).toContain('Shortcuts')
  })
})
