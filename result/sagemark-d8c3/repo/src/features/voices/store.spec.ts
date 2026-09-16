import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { asCharacterId } from '@core/ids/brand'

import { useVoiceStore } from './store'

const charA = asCharacterId('char_A')

describe('useVoiceStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('returns default voice for unseen character', () => {
    const store = useVoiceStore()
    expect(store.get(charA).pitch).toBe('mid')
  })

  it('setPitch updates and persists', () => {
    const store = useVoiceStore()
    store.setPitch(charA, 'gravelly')
    expect(store.get(charA).pitch).toBe('gravelly')
  })

  it('setPace and setVolume travel through', () => {
    const store = useVoiceStore()
    store.setPace(charA, 'staccato')
    store.setVolume(charA, 'loud')
    expect(store.get(charA).pace).toBe('staccato')
    expect(store.get(charA).volume).toBe('loud')
  })

  it('setText updates the named field with trimming', () => {
    const store = useVoiceStore()
    store.setText(charA, 'catchphrase', '  well now  ')
    expect(store.get(charA).catchphrase).toBe('well now')
  })

  it('clear drops the voice profile', () => {
    const store = useVoiceStore()
    store.setPitch(charA, 'gravelly')
    store.clear(charA)
    expect(store.get(charA).pitch).toBe('mid')
  })

  it('persists across re-init', () => {
    const first = useVoiceStore()
    first.setPitch(charA, 'low')
    setActivePinia(createPinia())
    const second = useVoiceStore()
    expect(second.get(charA).pitch).toBe('low')
  })
})
