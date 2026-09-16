import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { asCampaignId, asQuestId } from '@core/ids/brand'
import type { Quest } from '@core/models/quest'
import { asTimestamp } from '@core/time/timestamps'

import ObjectiveBar from './ObjectiveBar.vue'

function build(over: Partial<Quest> = {}): Quest {
  return {
    id: asQuestId('q_X'),
    campaignId: asCampaignId('camp_X'),
    title: 'Find the bell',
    description: '',
    status: 'accepted',
    priority: 'normal',
    giverId: null,
    arcId: null,
    reward: '',
    objectives: [],
    createdAt: asTimestamp('2026-04-01T10:00:00Z'),
    updatedAt: asTimestamp('2026-04-01T10:00:00Z'),
    ...over,
  }
}

describe('ObjectiveBar', () => {
  it('shows zero over zero for empty objectives', () => {
    const w = mount(ObjectiveBar, { props: { quest: build() } })
    expect(w.text()).toContain('0 / 0')
  })

  it('reports done over total', () => {
    const quest = build({
      objectives: [
        { id: 'o1', text: 'A', completed: true },
        { id: 'o2', text: 'B', completed: false },
        { id: 'o3', text: 'C', completed: true },
      ],
    })
    const w = mount(ObjectiveBar, { props: { quest } })
    expect(w.text()).toContain('2 / 3')
  })

  it('paints the bar based on ratio', () => {
    const quest = build({
      objectives: [{ id: 'o1', text: 'A', completed: true }],
    })
    const w = mount(ObjectiveBar, { props: { quest } })
    const bar = w.find('[role="progressbar"]')
    expect(bar.attributes('aria-valuenow')).toBe('100')
    expect(bar.classes().join(' ')).toContain('bg-moss-500')
  })

  it('uses the parchment tone when there are no objectives', () => {
    const w = mount(ObjectiveBar, { props: { quest: build() } })
    const bar = w.find('[role="progressbar"]')
    expect(bar.classes().join(' ')).toContain('bg-parchment-200')
  })
})
