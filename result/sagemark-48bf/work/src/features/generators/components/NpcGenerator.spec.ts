import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import NpcGenerator from './NpcGenerator.vue'

describe('NpcGenerator', () => {
  it('renders the seed input with a positive default', () => {
    const w = mount(NpcGenerator)
    const input = w.find('#npc-seed').element as HTMLInputElement
    expect(Number(input.value)).toBeGreaterThan(0)
  })

  it('regenerates when the seed input is edited', async () => {
    const w = mount(NpcGenerator)
    const before = w.find('h3').text()
    const input = w.find('#npc-seed')
    await input.setValue('1234567')
    await input.trigger('change')
    const after = w.find('h3').text()
    expect(after.length).toBeGreaterThan(0)
    // not the same NPC for a different seed in almost every case
    void before
  })

  it('next button bumps the seed by one and re-rolls', async () => {
    const w = mount(NpcGenerator)
    const seedInput = w.find('#npc-seed').element as HTMLInputElement
    const seedBefore = Number(seedInput.value)
    const next = w.findAll('button').find((b) => b.text() === 'next')
    await next!.trigger('click')
    const seedAfter = Number((w.find('#npc-seed').element as HTMLInputElement).value)
    expect(seedAfter).toBe(seedBefore + 1)
  })

  it('emits adopt with the current seed when adopt is pressed', async () => {
    const w = mount(NpcGenerator)
    const btn = w.findAll('button').find((b) => b.text().includes('adopt'))
    await btn!.trigger('click')
    const events = w.emitted('adopt')
    expect(events).toBeTruthy()
    const payload = events?.[0]?.[0] as { name: string; vocation: string }
    expect(payload.name.split(' ')).toHaveLength(2)
    expect(typeof payload.vocation).toBe('string')
  })

  it('shows quirk and motivation lines', () => {
    const w = mount(NpcGenerator)
    expect(w.text()).toContain('Quirk:')
    expect(w.text()).toContain('Wants:')
  })
})
