import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import SettingsPage from './SettingsPage.vue'
import { useSettingsStore } from '../store'

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/settings', component: SettingsPage },
    ],
  })
}

describe('SettingsPage', () => {
  let router: Router

  beforeEach(async () => {
    setActivePinia(createPinia())
    window.localStorage.clear()
    router = makeRouter()
    await router.push('/settings')
    await router.isReady()
  })

  it('shows current theme highlighted', () => {
    const w = mount(SettingsPage, { global: { plugins: [router] } })
    const parchmentBtn = w.findAll('button').find((b) => b.text() === 'parchment')
    expect(parchmentBtn?.classes().join(' ')).toContain('bg-ink-700')
  })

  it('switches theme on click', async () => {
    const settings = useSettingsStore()
    const w = mount(SettingsPage, { global: { plugins: [router] } })
    const ink = w.findAll('button').find((b) => b.text() === 'ink')
    await ink!.trigger('click')
    expect(settings.theme).toBe('ink')
  })

  it('changes default die on select', async () => {
    const settings = useSettingsStore()
    const w = mount(SettingsPage, { global: { plugins: [router] } })
    await w.get('#setting-default-die').setValue('10')
    expect(settings.dice.defaultDie).toBe(10)
  })

  it('changes calendar months per year', async () => {
    const settings = useSettingsStore()
    const w = mount(SettingsPage, { global: { plugins: [router] } })
    const input = w.get('#setting-months')
    ;(input.element as HTMLInputElement).value = '13'
    await input.trigger('change')
    expect(settings.calendar.monthsPerYear).toBe(13)
  })

  it('reset button restores defaults', async () => {
    const settings = useSettingsStore()
    settings.setTheme('ink')
    const w = mount(SettingsPage, { global: { plugins: [router] } })
    const reset = w.findAll('button').find((b) => b.text() === 'Reset to defaults')
    await reset!.trigger('click')
    expect(settings.theme).toBe('parchment')
  })
})
