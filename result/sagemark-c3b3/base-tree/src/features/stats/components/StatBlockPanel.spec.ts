import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { asCharacterId } from '@core/ids/brand'

import { useStatBlockStore } from '../store'

import StatBlockPanel from './StatBlockPanel.vue'

const charA = asCharacterId('char_A')

describe('StatBlockPanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('renders the default block badges and ability columns', () => {
    const w = mount(StatBlockPanel, { props: { characterId: charA } })
    expect(w.text()).toContain('10 / 10 hp')
    expect(w.text()).toContain('AC')
    expect(w.text()).toContain('Speed')
    expect(w.text()).toContain('STR')
    expect(w.text()).toContain('CHA')
  })

  it('apply damage subtracts hp', async () => {
    const w = mount(StatBlockPanel, { props: { characterId: charA } })
    const btn = w.findAll('button').find((b) => b.text() === 'apply damage')
    await btn!.trigger('click')
    expect(useStatBlockStore().get(charA).hp).toBe(5)
  })

  it('apply heal restores hp up to the cap', async () => {
    const store = useStatBlockStore()
    store.damage(charA, 5)
    const w = mount(StatBlockPanel, { props: { characterId: charA } })
    const heal = w.findAll('button').find((b) => b.text() === 'apply heal')
    await heal!.trigger('click')
    expect(store.get(charA).hp).toBe(10)
  })

  it('full rest tops off hp', async () => {
    const store = useStatBlockStore()
    store.damage(charA, 9)
    const w = mount(StatBlockPanel, { props: { characterId: charA } })
    const rest = w.findAll('button').find((b) => b.text() === 'full rest')
    await rest!.trigger('click')
    expect(store.get(charA).hp).toBe(10)
  })

  it('ac + button bumps the ac', async () => {
    const w = mount(StatBlockPanel, { props: { characterId: charA } })
    const acButtons = w.findAll('button').filter((b) => b.text() === '+')
    // First +/- pair is AC; second is Speed
    await acButtons[0]!.trigger('click')
    expect(useStatBlockStore().get(charA).ac).toBe(11)
  })

  it('shows passive perception derived from wisdom', () => {
    const w = mount(StatBlockPanel, {
      props: { characterId: charA, perceptionProficient: true },
    })
    expect(w.text()).toContain('Passive perception')
  })
})
