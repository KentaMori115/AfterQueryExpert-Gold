import { mount, flushPromises } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { asCampaignId } from '@core/ids'

import EncounterForm from './EncounterForm.vue'

const camp = asCampaignId('camp_TEST123456')

describe('EncounterForm', () => {
  it('renders defaults', () => {
    const w = mount(EncounterForm, { props: { campaignId: camp } })
    expect((w.get('#encounter-kind').element as HTMLSelectElement).value).toBe('combat')
    expect((w.get('#encounter-difficulty').element as HTMLSelectElement).value).toBe('medium')
  })

  it('seeds from initial', () => {
    const w = mount(EncounterForm, {
      props: { campaignId: camp, initial: { campaignId: camp, title: 'Ambush', kind: 'social' } },
    })
    expect((w.get('#encounter-title').element as HTMLInputElement).value).toBe('Ambush')
    expect((w.get('#encounter-kind').element as HTMLSelectElement).value).toBe('social')
  })

  it('emits submit on valid input', async () => {
    const w = mount(EncounterForm, { props: { campaignId: camp } })
    await w.get('#encounter-title').setValue('Guards')
    await w.find('form').trigger('submit.prevent')
    expect(w.emitted('submit')).toHaveLength(1)
  })

  it('rejects empty title', async () => {
    const w = mount(EncounterForm, { props: { campaignId: camp } })
    await w.find('form').trigger('submit.prevent')
    await flushPromises()
    expect(w.emitted('submit')).toBeUndefined()
  })

  it('cancel emits', async () => {
    const w = mount(EncounterForm, { props: { campaignId: camp } })
    const cancel = w.findAll('button').find((b) => b.text() === 'Cancel')
    await cancel!.trigger('click')
    expect(w.emitted('cancel')).toHaveLength(1)
  })
})
