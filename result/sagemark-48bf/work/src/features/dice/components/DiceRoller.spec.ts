import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import DiceRoller from './DiceRoller.vue'
import { useDiceStore } from '../store'

describe('DiceRoller', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('rolls when the Roll button is clicked and shows in recent', async () => {
    const dice = useDiceStore()
    const w = mount(DiceRoller)
    await w.get('#dice-expression').setValue('d20')
    const roll = w.findAll('button').find((b) => b.text() === 'Roll')
    await roll!.trigger('click')
    await flushPromises()
    expect(dice.history).toHaveLength(1)
    expect(w.text()).toContain('= ')
  })

  it('surfaces a parse error inline', async () => {
    const w = mount(DiceRoller)
    await w.get('#dice-expression').setValue('not a roll')
    const roll = w.findAll('button').find((b) => b.text() === 'Roll')
    await roll!.trigger('click')
    expect(w.text().toLowerCase()).toContain('unrecognised')
  })

  it('quick die chips reroll', async () => {
    const dice = useDiceStore()
    const w = mount(DiceRoller)
    const chip = w.findAll('button').find((b) => b.text() === 'd6')
    await chip!.trigger('click')
    expect(dice.history[0]?.result.expression).toBe('d6')
  })

  it('clear button empties history', async () => {
    const dice = useDiceStore()
    dice.roll('d20')
    const w = mount(DiceRoller)
    const clear = w.findAll('button').find((b) => b.text() === 'clear')
    await clear!.trigger('click')
    expect(dice.history).toEqual([])
  })

  it('applies a preset to the form on click', async () => {
    const dice = useDiceStore()
    const preset = dice.presets[0]!
    const w = mount(DiceRoller)
    const btn = w.findAll('button').find((b) => b.text().includes(preset.label))
    await btn!.trigger('click')
    const input = w.get('#dice-expression').element as HTMLInputElement
    expect(input.value).toBe(preset.expression)
  })

  it('roll on a preset row adds to history with its label', async () => {
    const dice = useDiceStore()
    const preset = dice.presets[0]!
    const w = mount(DiceRoller)
    const rollButtons = w.findAll('button').filter((b) => b.text() === 'roll')
    await rollButtons[0]!.trigger('click')
    expect(dice.history[0]?.label).toBe(preset.label)
  })

  it('Save preset adds it to the store', async () => {
    const dice = useDiceStore()
    const before = dice.presets.length
    const w = mount(DiceRoller)
    await w.get('#preset-label').setValue('Crit')
    await w.get('#preset-expression').setValue('2d8 + 4')
    const presetForm = w.findAll('form').find((f) => f.find('#preset-label').exists())
    await presetForm!.trigger('submit.prevent')
    expect(dice.presets.length).toBe(before + 1)
    const last = dice.presets[dice.presets.length - 1]
    expect(last?.label).toBe('Crit')
  })

  it('delete preset with confirm removes it', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const dice = useDiceStore()
    const preset = dice.presets[0]!
    const w = mount(DiceRoller)
    const delButtons = w.findAll('button').filter((b) => b.text() === 'delete')
    await delButtons[0]!.trigger('click')
    expect(dice.presets.find((p) => p.id === preset.id)).toBeUndefined()
    confirmSpy.mockRestore()
  })
})
