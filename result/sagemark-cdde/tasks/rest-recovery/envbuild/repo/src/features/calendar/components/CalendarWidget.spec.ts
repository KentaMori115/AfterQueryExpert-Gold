import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import CalendarWidget from './CalendarWidget.vue'

const shape = { monthsPerYear: 12, daysPerMonth: 30 }

describe('CalendarWidget', () => {
  it('renders a button per day of the month', () => {
    const w = mount(CalendarWidget, { props: { shape, today: { year: 1, month: 1, day: 1 } } })
    const buttons = w.findAll('button[aria-label^="Day"]')
    expect(buttons).toHaveLength(30)
  })

  it('emits select with the clicked day', async () => {
    const w = mount(CalendarWidget, { props: { shape, today: { year: 1, month: 1, day: 1 } } })
    const buttons = w.findAll('button[aria-label^="Day"]')
    await buttons[3]!.trigger('click')
    const events = w.emitted('select')
    expect(events?.[0]?.[0]).toEqual({ year: 1, month: 1, day: 4 })
  })

  it('next month advances the cursor', async () => {
    const w = mount(CalendarWidget, { props: { shape, today: { year: 1, month: 1, day: 1 } } })
    const next = w.findAll('button').find((b) => b.text() === 'next month')
    await next!.trigger('click')
    expect(w.text()).toContain('Month 2')
  })

  it('next year advances the year', async () => {
    const w = mount(CalendarWidget, { props: { shape, today: { year: 1, month: 1, day: 1 } } })
    const next = w.findAll('button').find((b) => b.text() === 'next year')
    await next!.trigger('click')
    expect(w.text()).toContain('2')
  })

  it('shows event dots and labels on matching days', () => {
    const w = mount(CalendarWidget, {
      props: {
        shape,
        today: { year: 1, month: 1, day: 1 },
        events: [{ date: { year: 1, month: 1, day: 5 }, label: 'Coronation', tone: 'warning' }],
      },
    })
    expect(w.text()).toContain('Coronation')
  })

  it('jumps back to today via the today button', async () => {
    const w = mount(CalendarWidget, { props: { shape, today: { year: 1, month: 1, day: 1 } } })
    const next = w.findAll('button').find((b) => b.text() === 'next year')
    await next!.trigger('click')
    expect(w.text()).toContain('2')
    const today = w.findAll('button').find((b) => b.text() === 'today')
    await today!.trigger('click')
    expect(w.text()).toContain('Month 1 of 12')
  })

  it('honours a custom year suffix', () => {
    const w = mount(CalendarWidget, {
      props: { shape, today: { year: 1234, month: 1, day: 1 }, yearSuffix: ' DR' },
    })
    expect(w.text()).toContain('1234 DR')
  })
})
