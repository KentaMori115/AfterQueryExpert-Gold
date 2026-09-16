import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { asEncounterId } from '@core/ids/brand'

import { useLightStore } from '../store'

import LightTrackerPanel from './LightTrackerPanel.vue'

const enc = asEncounterId('enc_X')

describe('LightTrackerPanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('shows the empty hint when no torches are lit', () => {
    const w = mount(LightTrackerPanel, { props: { encounterId: enc } })
    expect(w.text()).toContain('No torches lit')
  })

  it('add button creates a torch', async () => {
    const w = mount(LightTrackerPanel, { props: { encounterId: enc } })
    const add = w.findAll('button').find((b) => b.text() === 'add')
    await add!.trigger('click')
    expect(useLightStore().forEncounter(enc)).toHaveLength(1)
    expect(w.text()).toContain('Torch')
  })

  it('burn button drops remaining minutes', async () => {
    const store = useLightStore()
    store.add(enc, 'torch', 'Iris')
    const w = mount(LightTrackerPanel, { props: { encounterId: enc } })
    await w.find('#light-tick').setValue(15)
    const burn = w.findAll('button').find((b) => b.text() === 'burn')
    await burn!.trigger('click')
    const torch = useLightStore().forEncounter(enc)[0]!
    expect(torch.remainingMinutes).toBe(45)
  })

  it('snuff zeros the time on a single torch', async () => {
    const store = useLightStore()
    const torch = store.add(enc, 'torch', 'Iris')
    const w = mount(LightTrackerPanel, { props: { encounterId: enc } })
    const snuff = w.findAll('button').find((b) => b.text() === 'snuff')
    await snuff!.trigger('click')
    expect(useLightStore().forEncounter(enc).find((t) => t.id === torch.id)!.remainingMinutes).toBe(0)
  })

  it('remove drops the torch entirely', async () => {
    const store = useLightStore()
    store.add(enc, 'torch', 'Iris')
    const w = mount(LightTrackerPanel, { props: { encounterId: enc } })
    const remove = w.findAll('button').find((b) => b.text() === 'remove')
    await remove!.trigger('click')
    expect(useLightStore().forEncounter(enc)).toEqual([])
  })

  it('reflects unlimited burn for a driftglobe', async () => {
    const w = mount(LightTrackerPanel, { props: { encounterId: enc } })
    await w.find('#light-source').setValue('driftglobe')
    await w.findAll('button').find((b) => b.text() === 'add')!.trigger('click')
    expect(w.text()).toContain('unlimited')
  })
})
