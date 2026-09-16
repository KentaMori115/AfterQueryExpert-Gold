import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { asCampaignId, asCharacterId } from '@core/ids'

import XpPanel from './XpPanel.vue'
import { useXpStore } from '../store'

const campaignId = asCampaignId('camp_TESTABCDEF')
const characterId = asCharacterId('char_A0000000')

describe('XpPanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('shows zero and level 1 initially', () => {
    const w = mount(XpPanel, { props: { campaignId, characterId } })
    expect(w.text()).toContain('0 xp')
    expect(w.text()).toContain('level 1')
  })

  it('award xp lifts the total and level', async () => {
    const w = mount(XpPanel, { props: { campaignId, characterId } })
    await w.get('#xp-amount').setValue('900')
    await w.find('form').trigger('submit.prevent')
    await flushPromises()
    expect(w.text()).toContain('900 xp total')
    expect(w.text()).toContain('level 3')
  })

  it('deduct subtracts xp', async () => {
    const store = useXpStore()
    store.recordAward({ campaignId, characterId, amount: 500 })
    const w = mount(XpPanel, { props: { campaignId, characterId } })
    await w.get('#xp-kind').setValue('deduct')
    await w.get('#xp-amount').setValue('200')
    await w.find('form').trigger('submit.prevent')
    await flushPromises()
    expect(store.totalFor(characterId)).toBe(300)
  })

  it('milestone adds xp as a positive award kind', async () => {
    const store = useXpStore()
    const w = mount(XpPanel, { props: { campaignId, characterId } })
    await w.get('#xp-kind').setValue('milestone')
    await w.get('#xp-amount').setValue('1500')
    await w.find('form').trigger('submit.prevent')
    await flushPromises()
    expect(store.totalFor(characterId)).toBe(1500)
  })

  it('clamps level at 20 when xp is very large', async () => {
    const w = mount(XpPanel, { props: { campaignId, characterId } })
    await w.get('#xp-amount').setValue('1000000')
    await w.find('form').trigger('submit.prevent')
    await flushPromises()
    expect(w.text()).toContain('level 20')
    expect(w.text()).toContain('Max level 20')
  })

  it('shows history detail when there is at least one entry', async () => {
    const store = useXpStore()
    store.recordAward({ campaignId, characterId, amount: 100, reason: 'cleared bandits' })
    const w = mount(XpPanel, { props: { campaignId, characterId } })
    expect(w.text()).toContain('History (1)')
  })

  it('remove deletes a single entry with confirm', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const store = useXpStore()
    const entry = store.recordAward({ campaignId, characterId, amount: 100 })
    const w = mount(XpPanel, { props: { campaignId, characterId } })
    const details = w.find('details')
    details.element.open = true
    await details.trigger('toggle')
    const remove = w.findAll('button').find((b) => b.text() === 'remove')
    await remove!.trigger('click')
    expect(store.forCharacter(characterId).find((e) => e.id === entry.id)).toBeUndefined()
    confirmSpy.mockRestore()
  })
})
