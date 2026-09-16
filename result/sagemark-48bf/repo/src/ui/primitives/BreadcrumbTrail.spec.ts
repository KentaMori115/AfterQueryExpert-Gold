import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import BreadcrumbTrail from './BreadcrumbTrail.vue'

function withRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:any(.*)', component: { template: '<div />' } }],
  })
}

describe('BreadcrumbTrail', () => {
  it('renders each crumb label', () => {
    const w = mount(BreadcrumbTrail, {
      props: {
        crumbs: [
          { to: '/', label: 'Home' },
          { to: '/campaigns', label: 'Campaigns' },
          { label: 'Frozen Gate' },
        ],
      },
      global: { plugins: [withRouter()] },
    })
    expect(w.text()).toContain('Home')
    expect(w.text()).toContain('Campaigns')
    expect(w.text()).toContain('Frozen Gate')
  })

  it('renders links for everything except the last crumb', () => {
    const w = mount(BreadcrumbTrail, {
      props: {
        crumbs: [
          { to: '/', label: 'Home' },
          { to: '/campaigns', label: 'Campaigns' },
          { to: '/ignored', label: 'Frozen Gate' },
        ],
      },
      global: { plugins: [withRouter()] },
    })
    const links = w.findAll('a')
    expect(links).toHaveLength(2)
    expect(links[0]!.attributes('href')).toBe('/')
    expect(links[1]!.attributes('href')).toBe('/campaigns')
  })

  it('marks the last crumb as plain text even with a to', () => {
    const w = mount(BreadcrumbTrail, {
      props: { crumbs: [{ to: '/', label: 'Only' }] },
      global: { plugins: [withRouter()] },
    })
    expect(w.findAll('a')).toHaveLength(0)
    expect(w.text()).toContain('Only')
  })

  it('places separators between crumbs but not at the end', () => {
    const w = mount(BreadcrumbTrail, {
      props: {
        crumbs: [
          { label: 'A' },
          { label: 'B' },
          { label: 'C' },
        ],
      },
      global: { plugins: [withRouter()] },
    })
    const separators = w.findAll('span[aria-hidden="true"]')
    expect(separators).toHaveLength(2)
  })
})
