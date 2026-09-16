import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import InitiativeTracker from './InitiativeTracker.vue'

describe('InitiativeTracker', () => {
  it('shows empty hint with no entries', () => {
    const w = mount(InitiativeTracker, { props: { modelValue: [] } })
    expect(w.text()).toContain('No one in the order yet')
  })

  it('renders entries in descending initiative order', () => {
    const w = mount(InitiativeTracker, {
      props: {
        modelValue: [
          { characterId: null, name: 'A', initiative: 5, hp: 10, notes: '' },
          { characterId: null, name: 'B', initiative: 20, hp: 10, notes: '' },
        ],
      },
    })
    const items = w.findAll('li')
    expect(items).toHaveLength(2)
    expect(items[0]!.text()).toContain('B')
    expect(items[1]!.text()).toContain('A')
  })

  it('emits update with added entry', async () => {
    const w = mount(InitiativeTracker, { props: { modelValue: [] } })
    await w.get('#init-name').setValue('Goblin')
    await w.get('#init-roll').setValue('12')
    await w.get('#init-hp').setValue('7')
    await w.find('form').trigger('submit.prevent')
    const events = w.emitted('update:modelValue')
    expect(events).toHaveLength(1)
    const payload = events?.[0]?.[0] as Array<{ name: string }>
    expect(payload[0]?.name).toBe('Goblin')
  })

  it('refuses to add an entry with blank name', async () => {
    const w = mount(InitiativeTracker, { props: { modelValue: [] } })
    await w.find('form').trigger('submit.prevent')
    expect(w.emitted('update:modelValue')).toBeUndefined()
  })

  it('emits update when remove is clicked', async () => {
    const initial = [{ characterId: null, name: 'A', initiative: 5, hp: 10, notes: '' }]
    const w = mount(InitiativeTracker, { props: { modelValue: initial } })
    const remove = w.findAll('button').find((b) => b.text() === 'remove')
    await remove!.trigger('click')
    const events = w.emitted('update:modelValue')
    expect((events?.[0]?.[0] as unknown[]).length).toBe(0)
  })

  it('adjusts hp via the - button', async () => {
    const initial = [{ characterId: null, name: 'A', initiative: 5, hp: 10, notes: '' }]
    const w = mount(InitiativeTracker, { props: { modelValue: initial } })
    const minus = w.findAll('button').find((b) => b.text() === '-')
    await minus!.trigger('click')
    const events = w.emitted('update:modelValue')
    expect((events?.[0]?.[0] as Array<{ hp: number }>)[0]?.hp).toBe(9)
  })

  it('counts and labels downed entries', () => {
    const w = mount(InitiativeTracker, {
      props: {
        modelValue: [
          { characterId: null, name: 'A', initiative: 5, hp: 10, notes: '' },
          { characterId: null, name: 'B', initiative: 5, hp: 0, notes: '' },
        ],
      },
    })
    expect(w.text()).toContain('1 downed')
  })
})
