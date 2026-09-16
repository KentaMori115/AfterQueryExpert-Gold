import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import EmptyState from './EmptyState.vue'

describe('EmptyState', () => {
  it('renders the title', () => {
    const w = mount(EmptyState, { props: { title: 'No campaigns yet' } })
    expect(w.text()).toContain('No campaigns yet')
  })

  it('renders an optional description', () => {
    const w = mount(EmptyState, {
      props: { title: 't', description: 'try creating one' },
    })
    expect(w.text()).toContain('try creating one')
  })

  it('omits the description when not supplied', () => {
    const w = mount(EmptyState, { props: { title: 't' } })
    expect(w.findAll('p')).toHaveLength(0)
  })

  it('shows the icon block when icon is set', () => {
    const w = mount(EmptyState, { props: { title: 't', icon: '*' } })
    expect(w.html()).toContain('rounded-full')
  })

  it('renders the action slot when provided', () => {
    const w = mount(EmptyState, {
      props: { title: 't' },
      slots: { action: '<button>Do it</button>' },
    })
    expect(w.text()).toContain('Do it')
  })
})
