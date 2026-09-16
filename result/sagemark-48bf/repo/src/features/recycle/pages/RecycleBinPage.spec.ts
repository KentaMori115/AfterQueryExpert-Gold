import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import RecycleBinPage from './RecycleBinPage.vue'
import { useRecycleStore } from '../store'

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/recycle', component: RecycleBinPage },
    ],
  })
}

describe('RecycleBinPage', () => {
  let router: Router

  beforeEach(async () => {
    setActivePinia(createPinia())
    window.localStorage.clear()
    router = makeRouter()
    await router.push('/recycle')
    await router.isReady()
  })

  it('shows the empty state when nothing is recycled', () => {
    const w = mount(RecycleBinPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Nothing here')
  })

  it('lists recycled entries when present', () => {
    const store = useRecycleStore()
    store.rememberDelete('character', { name: 'Iris', id: 'char_X' })
    const w = mount(RecycleBinPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Iris')
    expect(w.text()).toContain('character')
  })

  it('forget forever removes the entry with confirm', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const store = useRecycleStore()
    const e = store.rememberDelete('faction', { name: 'Iron Hand' })
    const w = mount(RecycleBinPage, { global: { plugins: [router] } })
    const btn = w.findAll('button').find((b) => b.text() === 'forget forever')
    await btn!.trigger('click')
    expect(store.entries.find((x) => x.id === e.id)).toBeUndefined()
    confirmSpy.mockRestore()
  })

  it('filters by kind via the dropdown', async () => {
    const store = useRecycleStore()
    store.rememberDelete('character', { name: 'Iris' })
    store.rememberDelete('faction', { name: 'Iron Hand' })
    const w = mount(RecycleBinPage, { global: { plugins: [router] } })
    await w.get('#bin-kind').setValue('faction')
    expect(w.text()).toContain('Iron Hand')
    expect(w.text()).not.toContain('Iris')
  })

  it('retention input writes back to the store', async () => {
    const store = useRecycleStore()
    const w = mount(RecycleBinPage, { global: { plugins: [router] } })
    const input = w.get('#bin-ttl')
    ;(input.element as HTMLInputElement).value = '7'
    await input.trigger('change')
    expect(store.ttlDays).toBe(7)
  })

  it('purge expired surfaces a count notice', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    const w = mount(RecycleBinPage, { global: { plugins: [router] } })
    const purge = w.findAll('button').find((b) => b.text() === 'Purge expired')
    await purge!.trigger('click')
    expect(alertSpy).toHaveBeenCalled()
    alertSpy.mockRestore()
  })
})
