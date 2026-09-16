import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import SurfaceCard from './SurfaceCard.vue'

describe('SurfaceCard', () => {
  it('renders the default slot', () => {
    const w = mount(SurfaceCard, { slots: { default: 'body content' } })
    expect(w.text()).toContain('body content')
  })

  it('renders title and hint when provided', () => {
    const w = mount(SurfaceCard, { props: { title: 'A', hint: 'B' } })
    expect(w.text()).toContain('A')
    expect(w.text()).toContain('B')
  })

  it('does not render a header when nothing is supplied', () => {
    const w = mount(SurfaceCard, { slots: { default: 'x' } })
    expect(w.find('h2').exists()).toBe(false)
  })

  it('renders header and footer slots', () => {
    const w = mount(SurfaceCard, {
      props: { title: 't' },
      slots: { header: '<span>HEADER</span>', footer: '<span>FOOTER</span>' },
    })
    expect(w.text()).toContain('HEADER')
    expect(w.text()).toContain('FOOTER')
  })

  it('renders as the chosen element', () => {
    const w = mount(SurfaceCard, { props: { as: 'section' }, slots: { default: 'x' } })
    expect(w.element.tagName.toLowerCase()).toBe('section')
  })
})
