import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { asEncounterId } from '@core/ids'
import type { InitiativeEntry } from '@core/models/encounter'

import InitiativeRunnerPanel from './InitiativeRunnerPanel.vue'
import { useInitiativeStore } from '../store'

const encId = asEncounterId('enc_ABC')

function build(): InitiativeEntry[] {
  return [
    { characterId: null, name: 'Alva', initiative: 18, hp: 12, notes: '' },
    { characterId: null, name: 'Brann', initiative: 10, hp: 8, notes: '' },
  ]
}

describe('InitiativeRunnerPanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('shows Begin combat when idle', () => {
    const w = mount(InitiativeRunnerPanel, {
      props: { encounterId: encId, entries: build() },
    })
    expect(w.text()).toContain('Begin combat')
  })

  it('clicking Begin combat starts the runner', async () => {
    const w = mount(InitiativeRunnerPanel, {
      props: { encounterId: encId, entries: build() },
    })
    const begin = w.findAll('button').find((b) => b.text() === 'Begin combat')
    await begin!.trigger('click')
    const runner = useInitiativeStore()
    expect(runner.getState(encId).round).toBe(1)
  })

  it('Next turn advances and Back rewinds', async () => {
    const runner = useInitiativeStore()
    runner.start(encId)
    const w = mount(InitiativeRunnerPanel, {
      props: { encounterId: encId, entries: build() },
    })
    const next = w.findAll('button').find((b) => b.text() === 'Next turn')
    await next!.trigger('click')
    expect(runner.getState(encId).turnIndex).toBe(1)
    const back = w.findAll('button').find((b) => b.text() === 'Back')
    await back!.trigger('click')
    expect(runner.getState(encId).turnIndex).toBe(0)
  })

  it('applying damage emits the updated entries', async () => {
    const runner = useInitiativeStore()
    runner.start(encId)
    const w = mount(InitiativeRunnerPanel, {
      props: { encounterId: encId, entries: build() },
    })
    const dmg = w.findAll('button').find((b) => b.text().startsWith('dmg'))
    await dmg!.trigger('click')
    const emitted = w.emitted('entries-changed')
    expect(emitted).toHaveLength(1)
    const next = emitted?.[0]?.[0] as InitiativeEntry[]
    expect(next[0]?.hp).toBe(11)
  })

  it('the condition input applies tags', async () => {
    const runner = useInitiativeStore()
    runner.start(encId)
    const w = mount(InitiativeRunnerPanel, {
      props: { encounterId: encId, entries: build() },
    })
    await w.get('#cond-target').setValue('Alva')
    await w.get('#cond-list').setValue('prone, blinded')
    const apply = w.findAll('button').find((b) => b.text() === 'Apply')
    await apply!.trigger('click')
    expect(runner.getState(encId).conditions.Alva).toEqual(['prone', 'blinded'])
  })

  it('End combat closes the runner', async () => {
    const runner = useInitiativeStore()
    runner.start(encId)
    const w = mount(InitiativeRunnerPanel, {
      props: { encounterId: encId, entries: build() },
    })
    const endBtn = w.findAll('button').find((b) => b.text() === 'End combat')
    await endBtn!.trigger('click')
    expect(runner.getState(encId).round).toBe(0)
  })
})
