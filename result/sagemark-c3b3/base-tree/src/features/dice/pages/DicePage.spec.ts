import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import DicePage from './DicePage.vue'

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/dice', component: DicePage },
    ],
  })
}

describe('DicePage', () => {
  let router: Router

  beforeEach(async () => {
    setActivePinia(createPinia())
    window.localStorage.clear()
    router = makeRouter()
    await router.push('/dice')
    await router.isReady()
  })

  it('renders header, subtitle and roller', () => {
    const w = mount(DicePage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Dice')
    expect(w.text()).toContain('Roll, keep history')
    expect(w.find('#dice-expression').exists()).toBe(true)
  })

  it('shows the breadcrumb trail', () => {
    const w = mount(DicePage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Home')
  })
})
