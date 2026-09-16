import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import MarkdownView from './MarkdownView.vue'

describe('MarkdownView', () => {
  it('shows the empty hint when source is empty', () => {
    const w = mount(MarkdownView, { props: { source: '' } })
    expect(w.text()).toContain('Nothing to show')
  })

  it('honours a custom empty message', () => {
    const w = mount(MarkdownView, { props: { source: '   ', empty: 'No lore yet' } })
    expect(w.text()).toContain('No lore yet')
  })

  it('renders headings and bold', () => {
    const w = mount(MarkdownView, { props: { source: '# Title\n\nThis is **bold** text.' } })
    expect(w.find('h1').text()).toBe('Title')
    expect(w.find('strong').text()).toBe('bold')
  })

  it('renders ordered and unordered lists', () => {
    const w = mount(MarkdownView, { props: { source: '- a\n- b\n\n1. one\n2. two' } })
    expect(w.findAll('ul li')).toHaveLength(2)
    expect(w.findAll('ol li')).toHaveLength(2)
  })

  it('renders a blockquote', () => {
    const w = mount(MarkdownView, { props: { source: '> wise saying' } })
    expect(w.find('blockquote').text()).toContain('wise saying')
  })

  it('renders an explicit link as anchor with target blank', () => {
    const w = mount(MarkdownView, {
      props: { source: 'visit [home](https://example.com)' },
    })
    expect(w.html()).toContain('href="https://example.com"')
    expect(w.html()).toContain('target="_blank"')
  })
})
