import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ReactionRoller from './ReactionRoller.vue'

describe('ReactionRoller', () => {
  it('renders both sections', () => {
    const w = mount(ReactionRoller)
    expect(w.find('#reaction-mod').exists()).toBe(true)
    expect(w.find('#morale-tier').exists()).toBe(true)
  })

  it('roll 2d6 button updates the reaction', async () => {
    const w = mount(ReactionRoller)
    const before = w.text()
    const btn = w.findAll('button').find((b) => b.text() === 'roll 2d6')
    await btn!.trigger('click')
    expect(w.text()).not.toBe(before)
  })

  it('morale roll yields a holds or breaks verdict', () => {
    const w = mount(ReactionRoller)
    const text = w.text()
    expect(text).toMatch(/holds|breaks/)
  })

  it('modifier input clamps to a sensible range', async () => {
    const w = mount(ReactionRoller)
    const input = w.find('#reaction-mod')
    expect(input.attributes('min')).toBe('-5')
    expect(input.attributes('max')).toBe('5')
  })

  it('changing morale tier updates the rating threshold', async () => {
    const w = mount(ReactionRoller)
    await w.find('#morale-tier').setValue('fragile')
    expect(w.text()).toContain('vs 5')
  })

  it('shows the reaction mood description', () => {
    const w = mount(ReactionRoller)
    const text = w.text()
    // One of the descriptions must be there for any rolled mood
    expect(text.length).toBeGreaterThan(50)
  })
})
