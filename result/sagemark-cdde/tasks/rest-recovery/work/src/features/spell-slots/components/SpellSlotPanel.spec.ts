import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { asCharacterId } from '@core/ids/brand'

import { useSpellSlotStore } from '../store'

import SpellSlotPanel from './SpellSlotPanel.vue'

const charA = asCharacterId('char_A')

describe('SpellSlotPanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('shows the bootstrap hint with no slots', () => {
    const w = mount(SpellSlotPanel, { props: { characterId: charA } })
    expect(w.text()).toContain('No slots set')
  })

  it('bootstrap button fills slots for the chosen caster level', async () => {
    const w = mount(SpellSlotPanel, { props: { characterId: charA } })
    await w.find('#bootstrap-level').setValue(5)
    const btn = w.findAll('button').find((b) => b.text() === 'bootstrap slots')
    await btn!.trigger('click')
    expect(useSpellSlotStore().get(charA)[3].max).toBe(2)
    expect(w.text()).toContain('L1')
  })

  it('spend reduces remaining via the row button', async () => {
    const store = useSpellSlotStore()
    store.bootstrap(charA, 5)
    const w = mount(SpellSlotPanel, { props: { characterId: charA } })
    const spend = w.findAll('button').find((b) => b.text() === 'spend')
    await spend!.trigger('click')
    expect(store.get(charA)[1].remaining).toBeLessThan(store.get(charA)[1].max)
  })

  it('long rest refills every slot', async () => {
    const store = useSpellSlotStore()
    store.bootstrap(charA, 5)
    store.spend(charA, 1)
    store.spend(charA, 2)
    const w = mount(SpellSlotPanel, { props: { characterId: charA } })
    const rest = w.findAll('button').find((b) => b.text() === 'long rest')
    await rest!.trigger('click')
    const s = store.get(charA)
    expect(s[1].remaining).toBe(s[1].max)
    expect(s[2].remaining).toBe(s[2].max)
  })

  it('total badge counts remaining vs max', async () => {
    const store = useSpellSlotStore()
    store.bootstrap(charA, 5)
    store.spend(charA, 1)
    const w = mount(SpellSlotPanel, { props: { characterId: charA } })
    expect(w.text()).toMatch(/\d+ \/ \d+ slots left/)
  })
})
