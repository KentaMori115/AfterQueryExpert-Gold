import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import { asCampaignId, asLocationId } from '@core/ids'
import { buildLocationTree, type Location } from '@core/models/location'
import { asTimestamp } from '@core/time/timestamps'

import LocationTreeView from './LocationTreeView.vue'

function loc(id: string, name: string, parentId: string | null = null): Location {
  return {
    id: asLocationId(id),
    campaignId: asCampaignId('camp_X'),
    parentId: parentId ? asLocationId(parentId) : null,
    name,
    kind: 'region',
    shortDescription: '',
    notes: '',
    visited: false,
    createdAt: asTimestamp('2025-01-01'),
    updatedAt: asTimestamp('2025-01-01'),
  }
}

function withRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:any(.*)', component: { template: '<div />' } }],
  })
}

describe('LocationTreeView', () => {
  it('shows the empty hint when tree is empty', () => {
    const w = mount(LocationTreeView, {
      props: { tree: [], routeBase: '/x' },
      global: { plugins: [withRouter()] },
    })
    expect(w.text()).toContain('Nothing mapped yet')
  })

  it('renders each location with a router link', () => {
    const r = loc('r', 'Root')
    const c = loc('c', 'Child', 'r')
    const tree = buildLocationTree([r, c])
    const w = mount(LocationTreeView, {
      props: { tree, routeBase: '/campaigns/camp_X/locations' },
      global: { plugins: [withRouter()] },
    })
    const hrefs = w.findAll('a').map((a) => a.attributes('href'))
    expect(hrefs).toContain('/campaigns/camp_X/locations/r')
    expect(hrefs).toContain('/campaigns/camp_X/locations/c')
  })

  it('indents children deeper than parents', () => {
    const r = loc('r', 'Root')
    const c = loc('c', 'Child', 'r')
    const tree = buildLocationTree([r, c])
    const w = mount(LocationTreeView, {
      props: { tree, routeBase: '/x' },
      global: { plugins: [withRouter()] },
    })
    const items = w.findAll('li')
    expect(items).toHaveLength(2)
    expect(items[1]!.attributes('style')).toContain('padding-left: 1.25rem')
  })

  it('shows "visited" badge for visited locations', () => {
    const r = { ...loc('r', 'R'), visited: true }
    const tree = buildLocationTree([r])
    const w = mount(LocationTreeView, {
      props: { tree, routeBase: '/x' },
      global: { plugins: [withRouter()] },
    })
    expect(w.text()).toContain('visited')
  })
})
