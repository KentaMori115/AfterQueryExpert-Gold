import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import StatusBadge from './StatusBadge.vue'

describe('StatusBadge', () => {
  it('renders the slot', () => {
    const w = mount(StatusBadge, { slots: { default: 'Active' } })
    expect(w.text()).toBe('Active')
  })

  it.each([
    ['success', 'bg-moss-400/20'],
    ['warning', 'bg-ember-100'],
    ['danger', 'bg-crimson-400/20'],
    ['info', 'bg-ink-100'],
    ['accent', 'bg-parchment-100'],
    ['neutral', 'bg-parchment-100'],
  ] as const)('applies the soft %s tone', (tone, sub) => {
    const w = mount(StatusBadge, { props: { tone } })
    expect(w.classes().join(' ')).toContain(sub)
  })

  it.each([
    ['success', 'bg-moss-500'],
    ['warning', 'bg-ember-500'],
    ['danger', 'bg-crimson-500'],
    ['info', 'bg-ink-700'],
    ['accent', 'bg-parchment-700'],
    ['neutral', 'bg-ink-200'],
  ] as const)('applies the solid %s tone when soft=false', (tone, sub) => {
    const w = mount(StatusBadge, { props: { tone, soft: false } })
    expect(w.classes().join(' ')).toContain(sub)
  })
})
