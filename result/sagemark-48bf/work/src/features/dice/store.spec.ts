import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useDiceStore } from './store'

describe('useDiceStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('starts with default presets and empty history', () => {
    const s = useDiceStore()
    expect(s.history).toEqual([])
    expect(s.presets.length).toBeGreaterThan(0)
  })

  it('rolls and pushes onto history newest first', () => {
    const s = useDiceStore()
    const a = s.roll('d20')
    const b = s.roll('d6')
    expect(s.history[0]?.id).toBe(b.id)
    expect(s.history[1]?.id).toBe(a.id)
  })

  it('caps history to the configured depth', () => {
    const s = useDiceStore()
    s.setDepth(3)
    for (let i = 0; i < 6; i++) s.roll('d20')
    expect(s.history).toHaveLength(3)
  })

  it('rolling a preset uses its expression and label', () => {
    const s = useDiceStore()
    const preset = s.presets[0]!
    const entry = s.rollPreset(preset.id)
    expect(entry?.label).toBe(preset.label)
    expect(entry?.result.expression).toBe(preset.expression)
  })

  it('rollPreset returns null for an unknown id', () => {
    const s = useDiceStore()
    expect(s.rollPreset('pre_nope')).toBe(null)
  })

  it('addPreset appends and updatePreset patches', () => {
    const s = useDiceStore()
    const created = s.addPreset('Critical', '2d6 + 4')
    const updated = s.updatePreset(created.id, { label: 'Crit', expression: '2d8 + 4' })
    expect(updated?.label).toBe('Crit')
    expect(updated?.expression).toBe('2d8 + 4')
  })

  it('addPreset falls back to expression as label when label is blank', () => {
    const s = useDiceStore()
    const created = s.addPreset('   ', '3d6')
    expect(created.label).toBe('3d6')
  })

  it('removePreset returns false for unknown id', () => {
    const s = useDiceStore()
    expect(s.removePreset('pre_nope')).toBe(false)
  })

  it('removePreset removes the preset', () => {
    const s = useDiceStore()
    const preset = s.presets[0]!
    expect(s.removePreset(preset.id)).toBe(true)
    expect(s.presets.find((p) => p.id === preset.id)).toBeUndefined()
  })

  it('clearHistory empties history', () => {
    const s = useDiceStore()
    s.roll('d20')
    s.clearHistory()
    expect(s.history).toEqual([])
  })

  it('setDepth clamps the value to a sensible range', () => {
    const s = useDiceStore()
    s.setDepth(-10)
    expect(s.depth).toBe(0)
    s.setDepth(1000)
    expect(s.depth).toBe(200)
  })

  it('persists history across reinit', () => {
    const a = useDiceStore()
    a.roll('d20')
    setActivePinia(createPinia())
    const b = useDiceStore()
    expect(b.history).toHaveLength(1)
  })

  it('persists presets across reinit', () => {
    const a = useDiceStore()
    a.addPreset('Custom', '3d8 + 2')
    setActivePinia(createPinia())
    const b = useDiceStore()
    expect(b.presets.find((p) => p.label === 'Custom')).toBeTruthy()
  })
})
