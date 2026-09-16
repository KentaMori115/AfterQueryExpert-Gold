import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import CommandPalette from './CommandPalette.vue'

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:rest(.*)', component: { template: '<div />' } }],
  })
}

describe('CommandPalette', () => {
  let router: Router

  beforeEach(async () => {
    setActivePinia(createPinia())
    window.localStorage.clear()
    router = makeRouter()
    await router.push('/')
    await router.isReady()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders nothing when closed', () => {
    const w = mount(CommandPalette, {
      props: { open: false },
      attachTo: document.body,
      global: { plugins: [router] },
    })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    w.unmount()
  })

  it('shows results when open', async () => {
    const w = mount(CommandPalette, {
      props: { open: true },
      attachTo: document.body,
      global: { plugins: [router] },
    })
    await flushPromises()
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    const items = document.querySelectorAll('li')
    expect(items.length).toBeGreaterThan(0)
    w.unmount()
  })

  it('emits close when Escape is pressed', async () => {
    const w = mount(CommandPalette, {
      props: { open: true },
      attachTo: document.body,
      global: { plugins: [router] },
    })
    await flushPromises()
    const input = document.querySelector('input') as HTMLInputElement
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await flushPromises()
    expect(w.emitted('close')).toBeTruthy()
    w.unmount()
  })

  it('clicking a result emits close', async () => {
    const w = mount(CommandPalette, {
      props: { open: true },
      attachTo: document.body,
      global: { plugins: [router] },
    })
    await flushPromises()
    const first = document.querySelector('li') as HTMLLIElement
    first.click()
    await flushPromises()
    expect(w.emitted('close')).toBeTruthy()
    w.unmount()
  })

  it('shows the empty hint when nothing matches', async () => {
    const w = mount(CommandPalette, {
      props: { open: true },
      attachTo: document.body,
      global: { plugins: [router] },
    })
    await flushPromises()
    const input = document.querySelector('input') as HTMLInputElement
    input.value = 'absolutelynothingxxxx'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    expect(document.body.textContent).toContain('Nothing matched')
    w.unmount()
  })
})
