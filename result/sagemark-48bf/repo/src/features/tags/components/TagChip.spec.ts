import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { asCampaignId, asTagId } from '@core/ids/brand'
import type { Tag } from '@core/models/tag'
import { asTimestamp } from '@core/time/timestamps'

import TagChip from './TagChip.vue'

function build(over: Partial<Tag> = {}): Tag {
  return {
    id: asTagId('tag_X'),
    campaignId: asCampaignId('camp_X'),
    name: 'Iron Banner',
    slug: 'iron-banner',
    tone: 'crimson',
    description: 'soldiers of the second oath',
    appliedTo: [],
    createdAt: asTimestamp('2026-04-01T10:00:00Z'),
    updatedAt: asTimestamp('2026-04-01T10:00:00Z'),
    ...over,
  }
}

describe('TagChip', () => {
  it('renders the name with the hash prefix and tone class', () => {
    const w = mount(TagChip, { props: { tag: build() } })
    expect(w.text()).toContain('Iron Banner')
    expect(w.text()).toContain('#')
    expect(w.classes().join(' ')).toContain('bg-crimson')
  })

  it('uses the description for the title attribute', () => {
    const w = mount(TagChip, { props: { tag: build({ description: 'long story' }) } })
    expect(w.attributes('title')).toBe('long story')
  })

  it('falls back to the name when there is no description', () => {
    const w = mount(TagChip, { props: { tag: build({ description: '' }) } })
    expect(w.attributes('title')).toBe('Iron Banner')
  })

  it('emits remove when the close button is clicked', async () => {
    const w = mount(TagChip, { props: { tag: build(), removable: true } })
    await w.find('button').trigger('click')
    expect(w.emitted('remove')).toBeTruthy()
  })

  it('emits pick only when interactive', async () => {
    const passive = mount(TagChip, { props: { tag: build() } })
    await passive.trigger('click')
    expect(passive.emitted('pick')).toBeUndefined()
    const active = mount(TagChip, { props: { tag: build(), interactive: true } })
    await active.trigger('click')
    expect(active.emitted('pick')).toBeTruthy()
  })
})
