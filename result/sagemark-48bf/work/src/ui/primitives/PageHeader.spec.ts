import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import PageHeader from './PageHeader.vue'

describe('PageHeader', () => {
  it('renders the title', () => {
    const w = mount(PageHeader, { props: { title: 'Campaigns' } })
    expect(w.find('h1').text()).toBe('Campaigns')
  })

  it('renders optional subtitle and meta', () => {
    const w = mount(PageHeader, {
      props: { title: 't', subtitle: 'Manage your runs', meta: '4 active' },
    })
    expect(w.text()).toContain('Manage your runs')
    expect(w.text()).toContain('4 active')
  })

  it('hides subtitle/meta when not provided', () => {
    const w = mount(PageHeader, { props: { title: 't' } })
    expect(w.findAll('p')).toHaveLength(0)
  })

  it('renders the default slot for actions', () => {
    const w = mount(PageHeader, {
      props: { title: 't' },
      slots: { default: '<button>New</button>' },
    })
    expect(w.text()).toContain('New')
  })
})
