import { describe, expect, it } from 'vitest'
import { compileQuery, parseQuery, QueryParseError } from './parser'

describe('query language', () => {
  it('parses boolean precedence so AND binds tighter than OR', () => {
    const ast = parseQuery("status = 'queued' or status = 'done' and priority = 'high'")
    expect(ast.type).toBe('or')
    if (ast.type === 'or') {
      expect(ast.right.type).toBe('and')
    }
  })

  it('compiles a predicate and rejects unknown fields', () => {
    const matches = compileQuery("status = 'done' and hours >= 2 and not priority = 'low'")
    expect(
      matches({ status: 'done', hours: 3, priority: 'high', title: 'A' })
    ).toBe(true)
    expect(
      matches({ status: 'done', hours: 3, priority: 'low', title: 'A' })
    ).toBe(false)
    expect(() => parseQuery("secret = 'x'")).toThrow(QueryParseError)
  })

  it('supports grouping and escaped quotes', () => {
    const matches = compileQuery("(title = 'It\\'s done' or title = 'x') and hours < 5")
    expect(matches({ title: "It's done", hours: 1 })).toBe(true)
  })
})
