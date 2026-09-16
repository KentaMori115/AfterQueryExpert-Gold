import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { asEncounterId } from '@core/ids/brand'

import { useLightStore } from './store'

const enc = asEncounterId('enc_X')

describe('useLightStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('returns no torches for a fresh encounter', () => {
    const store = useLightStore()
    expect(store.forEncounter(enc)).toEqual([])
  })

  it('adds a torch with the source default burn minutes', () => {
    const store = useLightStore()
    const t = store.add(enc, 'torch', 'Iris')
    expect(t.source).toBe('torch')
    expect(t.remainingMinutes).toBe(60)
    expect(store.forEncounter(enc)).toHaveLength(1)
  })

  it('ticks down every torch by the given minutes', () => {
    const store = useLightStore()
    store.add(enc, 'torch', 'Iris')
    store.add(enc, 'candle', 'Brann')
    store.tick(enc, 20)
    const torches = store.forEncounter(enc)
    expect(torches[0]!.remainingMinutes).toBe(40)
    expect(torches[1]!.remainingMinutes).toBe(40)
  })

  it('snuff zeros out a torch but keeps it on the list', () => {
    const store = useLightStore()
    const t = store.add(enc, 'torch', 'Iris')
    store.snuff(enc, t.id)
    const after = store.forEncounter(enc)[0]!
    expect(after.remainingMinutes).toBe(0)
  })

  it('remove drops it entirely', () => {
    const store = useLightStore()
    const t = store.add(enc, 'torch', 'Iris')
    store.remove(enc, t.id)
    expect(store.forEncounter(enc)).toEqual([])
  })

  it('setVision swaps the vision tier', () => {
    const store = useLightStore()
    const t = store.add(enc, 'torch', 'Iris')
    store.setVision(enc, t.id, 'darkvision-60')
    expect(store.forEncounter(enc)[0]!.vision).toBe('darkvision-60')
  })

  it('clear wipes the encounter', () => {
    const store = useLightStore()
    store.add(enc, 'torch', 'Iris')
    store.clear(enc)
    expect(store.forEncounter(enc)).toEqual([])
  })

  it('persists across re-init', () => {
    const first = useLightStore()
    first.add(enc, 'torch', 'Iris')
    setActivePinia(createPinia())
    const second = useLightStore()
    expect(second.forEncounter(enc)).toHaveLength(1)
  })
})
