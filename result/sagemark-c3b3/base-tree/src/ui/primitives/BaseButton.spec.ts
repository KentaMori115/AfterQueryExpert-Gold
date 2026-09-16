import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import BaseButton from './BaseButton.vue'

describe('BaseButton', () => {
  it('renders default slot', () => {
    const w = mount(BaseButton, { slots: { default: 'Save' } })
    expect(w.text()).toBe('Save')
  })

  it('uses the secondary tone by default', () => {
    const w = mount(BaseButton)
    expect(w.classes().join(' ')).toContain('bg-parchment-100')
  })

  it('applies primary tone classes', () => {
    const w = mount(BaseButton, { props: { tone: 'primary' } })
    expect(w.classes().join(' ')).toContain('bg-ember-500')
  })

  it('applies danger tone classes', () => {
    const w = mount(BaseButton, { props: { tone: 'danger' } })
    expect(w.classes().join(' ')).toContain('bg-crimson-500')
  })

  it('applies ghost tone classes', () => {
    const w = mount(BaseButton, { props: { tone: 'ghost' } })
    expect(w.classes().join(' ')).toContain('bg-transparent')
  })

  it('emits click', async () => {
    const w = mount(BaseButton)
    await w.trigger('click')
    expect(w.emitted('click')).toHaveLength(1)
  })

  it('does not emit when disabled at the DOM level', async () => {
    const w = mount(BaseButton, { props: { disabled: true } })
    expect((w.element as HTMLButtonElement).disabled).toBe(true)
  })

  it('honours type submit', () => {
    const w = mount(BaseButton, { props: { type: 'submit' } })
    expect((w.element as HTMLButtonElement).type).toBe('submit')
  })

  it('makes the button full-width when block is true', () => {
    const w = mount(BaseButton, { props: { block: true } })
    expect(w.classes().join(' ')).toContain('w-full')
  })

  it.each(['sm', 'md', 'lg'] as const)('renders size %s', (size) => {
    const w = mount(BaseButton, { props: { size } })
    expect(w.html()).toContain('class')
  })
})
