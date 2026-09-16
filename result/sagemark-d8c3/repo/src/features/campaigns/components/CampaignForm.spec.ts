import { mount, flushPromises } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import CampaignForm from './CampaignForm.vue'

describe('CampaignForm', () => {
  it('renders empty fields by default', () => {
    const w = mount(CampaignForm)
    expect((w.get('#campaign-name').element as HTMLInputElement).value).toBe('')
  })

  it('seeds fields from initial', () => {
    const w = mount(CampaignForm, {
      props: {
        initial: { name: 'X', tagline: 'tag', system: 'dnd5e', status: 'active' },
      },
    })
    expect((w.get('#campaign-name').element as HTMLInputElement).value).toBe('X')
    expect((w.get('#campaign-tagline').element as HTMLInputElement).value).toBe('tag')
  })

  it('emits submit with the typed values when valid', async () => {
    const w = mount(CampaignForm)
    await w.get('#campaign-name').setValue('The Frozen Gate')
    await w.get('#campaign-tagline').setValue('a frostbitten realm')
    await w.find('form').trigger('submit.prevent')
    const events = w.emitted('submit')
    expect(events).toHaveLength(1)
    expect(events?.[0]?.[0]).toMatchObject({
      name: 'The Frozen Gate',
      tagline: 'a frostbitten realm',
    })
  })

  it('does not emit submit when the name is empty and shows an error', async () => {
    const w = mount(CampaignForm)
    await w.find('form').trigger('submit.prevent')
    await flushPromises()
    expect(w.emitted('submit')).toBeUndefined()
    expect(w.text().toLowerCase()).toContain('required')
  })

  it('clears the error once a valid submit happens', async () => {
    const w = mount(CampaignForm)
    await w.find('form').trigger('submit.prevent')
    expect(w.text().toLowerCase()).toContain('required')
    await w.get('#campaign-name').setValue('Ok')
    await w.find('form').trigger('submit.prevent')
    expect(w.text().toLowerCase()).not.toContain('required')
  })

  it('emits cancel when cancel button is clicked', async () => {
    const w = mount(CampaignForm)
    const cancel = w.findAll('button').find((b) => b.text() === 'Cancel')
    expect(cancel).toBeDefined()
    await cancel!.trigger('click')
    expect(w.emitted('cancel')).toHaveLength(1)
  })

  it('disables the buttons when busy', () => {
    const w = mount(CampaignForm, { props: { busy: true } })
    const all = w.findAll('button')
    for (const b of all) {
      expect((b.element as HTMLButtonElement).disabled).toBe(true)
    }
  })

  it('respects custom button labels', () => {
    const w = mount(CampaignForm, {
      props: { submitLabel: 'Create', cancelLabel: 'Discard' },
    })
    expect(w.text()).toContain('Create')
    expect(w.text()).toContain('Discard')
  })
})
