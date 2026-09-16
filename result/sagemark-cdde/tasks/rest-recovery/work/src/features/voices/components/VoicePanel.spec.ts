import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { asCharacterId } from '@core/ids/brand'

import { useVoiceStore } from '../store'

import VoicePanel from './VoicePanel.vue'

const charA = asCharacterId('char_A')

describe('VoicePanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('renders the three button rows', () => {
    const w = mount(VoicePanel, { props: { characterId: charA } })
    expect(w.text()).toContain('Pitch')
    expect(w.text()).toContain('Pace')
    expect(w.text()).toContain('Volume')
  })

  it('clicking a pitch button updates the store', async () => {
    const w = mount(VoicePanel, { props: { characterId: charA } })
    const btn = w.findAll('button').find((b) => b.text() === 'gravelly')
    await btn!.trigger('click')
    expect(useVoiceStore().get(charA).pitch).toBe('gravelly')
  })

  it('catchphrase input saves on change', async () => {
    const w = mount(VoicePanel, { props: { characterId: charA } })
    const input = w.find('#voice-catch')
    await input.setValue('well now')
    await input.trigger('change')
    expect(useVoiceStore().get(charA).catchphrase).toBe('well now')
  })

  it('summary reflects the chosen options', async () => {
    const store = useVoiceStore()
    store.setPitch(charA, 'low')
    store.setText(charA, 'catchphrase', 'aye')
    const w = mount(VoicePanel, { props: { characterId: charA } })
    expect(w.text()).toContain('low pitch')
    expect(w.text()).toContain('catchphrase: aye')
  })
})
