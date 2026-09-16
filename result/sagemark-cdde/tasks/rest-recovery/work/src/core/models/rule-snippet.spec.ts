import { describe, expect, it } from 'vitest'

import { asTimestamp } from '../time/timestamps'

import {
  RULE_SCOPES,
  type RuleSnippet,
  compareForListing,
  ruleScopeLabel,
  ruleScopeTone,
  ruleSnippetDraftSchema,
} from './rule-snippet'

function build(over: Partial<RuleSnippet> = {}): RuleSnippet {
  return {
    id: 'rs_X',
    title: 'Cover rules',
    scope: 'combat',
    body: 'half cover gives +2, three quarters gives +5, full breaks line of sight',
    source: 'house ruling',
    pinned: false,
    createdAt: asTimestamp('2026-04-01T10:00:00Z'),
    updatedAt: asTimestamp('2026-04-01T10:00:00Z'),
    ...over,
  }
}

describe('scopes', () => {
  it('lists every scope with a label and tone', () => {
    expect(RULE_SCOPES).toContain('combat')
    for (const s of RULE_SCOPES) {
      expect(ruleScopeLabel(s).length).toBeGreaterThan(0)
      expect(typeof ruleScopeTone(s)).toBe('string')
    }
  })
})

describe('compareForListing', () => {
  it('puts pinned ahead of unpinned', () => {
    const a = build({ pinned: true, title: 'B' })
    const b = build({ pinned: false, title: 'A' })
    expect([b, a].sort(compareForListing).map((r) => r.title)).toEqual(['B', 'A'])
  })

  it('then sorts by scope alphabetically', () => {
    const a = build({ scope: 'magic', title: 'M' })
    const b = build({ scope: 'combat', title: 'C' })
    expect([a, b].sort(compareForListing).map((r) => r.scope)).toEqual(['combat', 'magic'])
  })

  it('finally sorts by title', () => {
    const a = build({ scope: 'combat', title: 'Brawl' })
    const b = build({ scope: 'combat', title: 'Aegis' })
    expect([a, b].sort(compareForListing).map((r) => r.title)).toEqual(['Aegis', 'Brawl'])
  })
})

describe('ruleSnippetDraftSchema', () => {
  it('accepts a clean draft', () => {
    expect(
      ruleSnippetDraftSchema.safeParse({
        title: 'Cover',
        scope: 'combat',
        body: 'half cover gives +2',
      }).success,
    ).toBe(true)
  })

  it('rejects an empty body', () => {
    expect(
      ruleSnippetDraftSchema.safeParse({
        title: 'Cover',
        scope: 'combat',
        body: '   ',
      }).success,
    ).toBe(false)
  })

  it('rejects an unknown scope', () => {
    expect(
      ruleSnippetDraftSchema.safeParse({
        title: 'Cover',
        scope: 'ritual',
        body: 'body',
      }).success,
    ).toBe(false)
  })

  it('rejects long bodies', () => {
    expect(
      ruleSnippetDraftSchema.safeParse({
        title: 'Cover',
        scope: 'combat',
        body: 'x'.repeat(3000),
      }).success,
    ).toBe(false)
  })
})
