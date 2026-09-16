import { mount, flushPromises } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { asCampaignId } from '@core/ids'

import CharacterForm from './CharacterForm.vue'

const camp = asCampaignId('camp_TEST123456')

describe('CharacterForm', () => {
  it('renders with sensible defaults', () => {
    const w = mount(CharacterForm, { props: { campaignId: camp } })
    expect((w.get('#character-name').element as HTMLInputElement).value).toBe('')
    expect((w.get('#character-kind').element as HTMLSelectElement).value).toBe('npc')
    expect((w.get('#character-level').element as HTMLInputElement).value).toBe('1')
  })

  it('seeds from initial values', () => {
    const w = mount(CharacterForm, {
      props: {
        campaignId: camp,
        initial: { campaignId: camp, name: 'Iris', kind: 'pc', level: 5, ancestry: 'elf' },
      },
    })
    expect((w.get('#character-name').element as HTMLInputElement).value).toBe('Iris')
    expect((w.get('#character-ancestry').element as HTMLInputElement).value).toBe('elf')
  })

  it('emits submit with parsed values on valid input', async () => {
    const w = mount(CharacterForm, { props: { campaignId: camp } })
    await w.get('#character-name').setValue('Brann')
    await w.find('form').trigger('submit.prevent')
    const events = w.emitted('submit')
    expect(events).toHaveLength(1)
    expect(events?.[0]?.[0]).toMatchObject({
      name: 'Brann',
      campaignId: camp,
      kind: 'npc',
    })
  })

  it('does not emit on empty name', async () => {
    const w = mount(CharacterForm, { props: { campaignId: camp } })
    await w.find('form').trigger('submit.prevent')
    await flushPromises()
    expect(w.emitted('submit')).toBeUndefined()
    expect(w.text().toLowerCase()).toContain('required')
  })

  it('rejects out-of-range level', async () => {
    const w = mount(CharacterForm, { props: { campaignId: camp } })
    await w.get('#character-name').setValue('OK')
    await w.get('#character-level').setValue('99')
    await w.find('form').trigger('submit.prevent')
    expect(w.emitted('submit')).toBeUndefined()
  })

  it('emits cancel on cancel click', async () => {
    const w = mount(CharacterForm, { props: { campaignId: camp } })
    const cancel = w.findAll('button').find((b) => b.text() === 'Cancel')
    await cancel!.trigger('click')
    expect(w.emitted('cancel')).toHaveLength(1)
  })

  it('honours custom submit/cancel labels', () => {
    const w = mount(CharacterForm, {
      props: { campaignId: camp, submitLabel: 'Create', cancelLabel: 'Back' },
    })
    expect(w.text()).toContain('Create')
    expect(w.text()).toContain('Back')
  })
})
