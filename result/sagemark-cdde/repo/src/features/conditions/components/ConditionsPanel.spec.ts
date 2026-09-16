import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { asCharacterId } from '@core/ids/brand'

import { useConditionStore } from '../store'

import ConditionsPanel from './ConditionsPanel.vue'

const charA = asCharacterId('char_A')

describe('ConditionsPanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('renders the exhaustion ladder and condition grid', () => {
    const w = mount(ConditionsPanel, { props: { characterId: charA } })
    expect(w.text()).toContain('No exhaustion')
    expect(w.text()).toContain('Conditions')
    expect(w.text()).toContain('Blinded')
    expect(w.text()).toContain('Unconscious')
  })

  it('toggling a condition adds it to the store', async () => {
    const w = mount(ConditionsPanel, { props: { characterId: charA } })
    const poisoned = w.findAll('button').find((b) => b.text() === 'Poisoned')
    await poisoned!.trigger('click')
    expect(useConditionStore().get(charA).active).toContain('poisoned')
  })

  it('clicking the same condition again removes it', async () => {
    const w = mount(ConditionsPanel, { props: { characterId: charA } })
    const poisoned = w.findAll('button').find((b) => b.text() === 'Poisoned')
    await poisoned!.trigger('click')
    await poisoned!.trigger('click')
    expect(useConditionStore().get(charA).active).not.toContain('poisoned')
  })

  it('long rest clears every condition', async () => {
    const store = useConditionStore()
    store.add(charA, 'poisoned')
    store.add(charA, 'prone')
    const w = mount(ConditionsPanel, { props: { characterId: charA } })
    const rest = w.findAll('button').find((b) => b.text() === 'long rest')
    await rest!.trigger('click')
    expect(store.get(charA).active).toEqual([])
  })

  it('setExhaustion via the number buttons jumps to the chosen level', async () => {
    const w = mount(ConditionsPanel, { props: { characterId: charA } })
    const level = w.findAll('button').find((b) => b.text() === '4')
    await level!.trigger('click')
    expect(useConditionStore().get(charA).exhaustion).toBe(4)
  })

  it('shows the incapacitated badge when stunned', async () => {
    useConditionStore().add(charA, 'stunned')
    const w = mount(ConditionsPanel, { props: { characterId: charA } })
    expect(w.text()).toContain('incapacitated')
  })
})
