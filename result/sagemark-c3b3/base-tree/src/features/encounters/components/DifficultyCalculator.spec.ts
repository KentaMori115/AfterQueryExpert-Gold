import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import DifficultyCalculator from './DifficultyCalculator.vue'

describe('DifficultyCalculator', () => {
  it('renders three default rows', () => {
    const w = mount(DifficultyCalculator)
    const rows = w.findAll('tbody tr')
    expect(rows).toHaveLength(3)
  })

  it('renders an initial verdict badge', () => {
    const w = mount(DifficultyCalculator)
    const text = w.text()
    expect(['Trivial', 'Easy', 'Medium', 'Hard', 'Deadly'].some((t) => text.includes(t))).toBe(true)
  })

  it('add row appends to the table', async () => {
    const w = mount(DifficultyCalculator)
    const btn = w.findAll('button').find((b) => b.text() === 'add row')
    await btn!.trigger('click')
    expect(w.findAll('tbody tr')).toHaveLength(4)
  })

  it('remove row removes the matching entry', async () => {
    const w = mount(DifficultyCalculator)
    const remove = w.findAll('button').find((b) => b.text() === 'remove')
    await remove!.trigger('click')
    expect(w.findAll('tbody tr')).toHaveLength(2)
  })

  it('clear button empties the rows', async () => {
    const w = mount(DifficultyCalculator)
    const btn = w.findAll('button').find((b) => b.text() === 'clear')
    await btn!.trigger('click')
    expect(w.findAll('tbody tr')).toHaveLength(0)
  })

  it('updating party level changes the verdict', async () => {
    const w = mount(DifficultyCalculator)
    const level = w.find('#party-level')
    await level.setValue(1)
    expect(w.text()).toContain('Deadly')
  })

  it('shows xp thresholds for every difficulty', () => {
    const w = mount(DifficultyCalculator)
    const text = w.text()
    expect(text).toContain('trivial')
    expect(text).toContain('easy')
    expect(text).toContain('medium')
    expect(text).toContain('hard')
    expect(text).toContain('deadly')
  })
})
