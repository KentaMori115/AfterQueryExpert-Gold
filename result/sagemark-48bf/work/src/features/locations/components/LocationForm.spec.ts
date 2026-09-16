import { mount, flushPromises } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { asCampaignId, asLocationId } from '@core/ids'
import type { Location } from '@core/models/location'
import { asTimestamp } from '@core/time/timestamps'

import LocationForm from './LocationForm.vue'

const camp = asCampaignId('camp_TESTABCDEF')

function buildParent(id: string, name: string): Location {
  return {
    id: asLocationId(id),
    campaignId: camp,
    parentId: null,
    name,
    kind: 'region',
    shortDescription: '',
    notes: '',
    visited: false,
    createdAt: asTimestamp('2025-01-01'),
    updatedAt: asTimestamp('2025-01-01'),
  }
}

describe('LocationForm', () => {
  it('renders default values', () => {
    const w = mount(LocationForm, { props: { campaignId: camp } })
    expect((w.get('#location-name').element as HTMLInputElement).value).toBe('')
    expect((w.get('#location-kind').element as HTMLSelectElement).value).toBe('region')
  })

  it('emits submit on valid input', async () => {
    const w = mount(LocationForm, { props: { campaignId: camp } })
    await w.get('#location-name').setValue('Frostfell')
    await w.find('form').trigger('submit.prevent')
    const events = w.emitted('submit')
    expect(events).toHaveLength(1)
    expect(events?.[0]?.[0]).toMatchObject({ name: 'Frostfell', campaignId: camp })
  })

  it('lists parent options', () => {
    const parents = [buildParent('p1', 'World'), buildParent('p2', 'Continent')]
    const w = mount(LocationForm, { props: { campaignId: camp, parents } })
    expect(w.text()).toContain('World')
    expect(w.text()).toContain('Continent')
  })

  it('excludes forbidParentId from the parent options', () => {
    const parents = [buildParent('p1', 'Allowed'), buildParent('p2', 'Forbidden')]
    const w = mount(LocationForm, {
      props: { campaignId: camp, parents, forbidParentId: asLocationId('p2') },
    })
    expect(w.text()).toContain('Allowed')
    expect(w.text()).not.toContain('Forbidden')
  })

  it('rejects empty name', async () => {
    const w = mount(LocationForm, { props: { campaignId: camp } })
    await w.find('form').trigger('submit.prevent')
    await flushPromises()
    expect(w.emitted('submit')).toBeUndefined()
  })

  it('cancel emits', async () => {
    const w = mount(LocationForm, { props: { campaignId: camp } })
    const cancel = w.findAll('button').find((b) => b.text() === 'Cancel')
    await cancel!.trigger('click')
    expect(w.emitted('cancel')).toHaveLength(1)
  })
})
