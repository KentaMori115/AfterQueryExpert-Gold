import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { asCharacterId } from '@core/ids/brand'

import { useCoinStore } from '../store'

import CoinPanel from './CoinPanel.vue'

const charA = asCharacterId('char_A')

describe('CoinPanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('renders zero totals and an empty purse hint', () => {
    const w = mount(CoinPanel, { props: { characterId: charA } })
    expect(w.text()).toContain('0 gp total')
    expect(w.text()).toContain('empty')
  })

  it('logs a bump through the form', async () => {
    const w = mount(CoinPanel, { props: { characterId: charA } })
    await w.find('#coin-amount').setValue(5)
    await w.find('input[type="text"]').setValue('tavern brawl')
    await w.find('form').trigger('submit.prevent')
    const store = useCoinStore()
    expect(store.purseFor(charA).gp).toBe(5)
    expect(w.text()).toContain('tavern brawl')
  })

  it('consolidate promotes copper upward', async () => {
    const store = useCoinStore()
    store.setPurse(charA, { cp: 250, sp: 0, ep: 0, gp: 0, pp: 0 })
    const w = mount(CoinPanel, { props: { characterId: charA } })
    const btn = w.findAll('button').find((b) => b.text() === 'consolidate')
    await btn!.trigger('click')
    const purse = store.purseFor(charA)
    expect(purse.cp).toBe(0)
    expect(purse.sp + purse.gp).toBeGreaterThan(0)
  })

  it('shows recent entries with reason and delta', async () => {
    const store = useCoinStore()
    store.bump(charA, 'gp', 9, 'sold a lyre')
    const w = mount(CoinPanel, { props: { characterId: charA } })
    expect(w.text()).toContain('sold a lyre')
    expect(w.text()).toContain('+9')
  })
})
