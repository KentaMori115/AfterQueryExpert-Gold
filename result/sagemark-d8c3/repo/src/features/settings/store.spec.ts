import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useSettingsStore } from './store'

describe('useSettingsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('returns defaults when no stored settings', () => {
    const s = useSettingsStore()
    expect(s.theme).toBe('parchment')
    expect(s.dice.defaultDie).toBe(20)
    expect(s.calendar.monthsPerYear).toBe(12)
  })

  it('setTheme persists', () => {
    const s = useSettingsStore()
    s.setTheme('ink')
    expect(s.theme).toBe('ink')
    const raw = window.localStorage.getItem('sagemark:settings:v1')
    expect(raw).toContain('"theme":"ink"')
  })

  it('setDice merges partial', () => {
    const s = useSettingsStore()
    s.setDice({ defaultDie: 10 })
    expect(s.dice.defaultDie).toBe(10)
    expect(s.dice.showInline).toBe(true)
  })

  it('setCalendar merges partial', () => {
    const s = useSettingsStore()
    s.setCalendar({ daysPerMonth: 28 })
    expect(s.calendar.daysPerMonth).toBe(28)
    expect(s.calendar.monthsPerYear).toBe(12)
  })

  it('reset restores defaults', () => {
    const s = useSettingsStore()
    s.setTheme('ink')
    s.reset()
    expect(s.theme).toBe('parchment')
  })

  it('loads persisted settings on a fresh store', () => {
    window.localStorage.setItem(
      'sagemark:settings:v1',
      JSON.stringify({ theme: 'ink', dice: { defaultDie: 100 } }),
    )
    setActivePinia(createPinia())
    const s = useSettingsStore()
    expect(s.theme).toBe('ink')
    expect(s.dice.defaultDie).toBe(100)
    // missing fields fall back to defaults
    expect(s.dice.showInline).toBe(true)
  })

  it('tolerates corrupt stored data', () => {
    window.localStorage.setItem('sagemark:settings:v1', '{not-valid-json')
    setActivePinia(createPinia())
    const s = useSettingsStore()
    expect(s.theme).toBe('parchment')
  })

  it('ignores unknown theme', () => {
    window.localStorage.setItem('sagemark:settings:v1', JSON.stringify({ theme: 'rainbow' }))
    setActivePinia(createPinia())
    const s = useSettingsStore()
    expect(s.theme).toBe('parchment')
  })
})
