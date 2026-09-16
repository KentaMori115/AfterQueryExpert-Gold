import { describe, expect, it } from 'vitest'

import { escapeHtml, renderMarkdown, stripMarkdown } from './markdown'

describe('escapeHtml', () => {
  it('escapes the obvious HTML metacharacters', () => {
    expect(escapeHtml('a & <b>"c"\'</b>')).toBe('a &amp; &lt;b&gt;&quot;c&quot;&#39;&lt;/b&gt;')
  })
})

describe('renderMarkdown', () => {
  it('returns empty string for empty input', () => {
    expect(renderMarkdown('')).toBe('')
  })

  it('renders a single paragraph wrapped in p', () => {
    expect(renderMarkdown('hello there')).toContain('<p>hello there</p>')
  })

  it('renders headings up to h3', () => {
    expect(renderMarkdown('# Title')).toContain('<h1>Title</h1>')
    expect(renderMarkdown('## Sub')).toContain('<h2>Sub</h2>')
    expect(renderMarkdown('### Smaller')).toContain('<h3>Smaller</h3>')
  })

  it('renders unordered and ordered lists', () => {
    expect(renderMarkdown('- one\n- two')).toContain('<ul class')
    expect(renderMarkdown('1. one\n2. two')).toContain('<ol class')
  })

  it('renders blockquotes', () => {
    expect(renderMarkdown('> a wise saying')).toContain('<blockquote')
  })

  it('renders fenced code blocks', () => {
    const html = renderMarkdown('```\nfoo()\n```')
    expect(html).toContain('<pre')
    expect(html).toContain('foo()')
  })

  it('renders strong and emphasis', () => {
    expect(renderMarkdown('this is **bold** and *italic*')).toContain('<strong>bold</strong>')
    expect(renderMarkdown('this is **bold** and *italic*')).toContain('<em>italic</em>')
  })

  it('renders inline code without breaking surrounding text', () => {
    expect(renderMarkdown('use `npm run dev`')).toContain('<code>npm run dev</code>')
  })

  it('renders explicit links', () => {
    const html = renderMarkdown('see [home](https://example.com)')
    expect(html).toContain('href="https://example.com"')
    expect(html).toContain('>home</a>')
  })

  it('autolinks bare urls', () => {
    const html = renderMarkdown('visit https://example.com here')
    expect(html).toContain('href="https://example.com"')
  })

  it('escapes html in the source', () => {
    expect(renderMarkdown('<script>alert(1)</script>')).not.toContain('<script>')
  })
})

describe('stripMarkdown', () => {
  it('removes formatting and returns plain text', () => {
    const plain = stripMarkdown('# Title\n\nThis is **bold** with `code` and [a link](https://x.com)')
    expect(plain).toContain('Title')
    expect(plain).toContain('bold')
    expect(plain).toContain('code')
    expect(plain).toContain('a link')
    expect(plain).not.toContain('**')
    expect(plain).not.toContain('#')
    expect(plain).not.toContain('http')
  })

  it('collapses whitespace', () => {
    expect(stripMarkdown('a   b\n\n  c')).toBe('a b c')
  })
})
